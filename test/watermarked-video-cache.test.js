import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import express from 'express';
import sharp from 'sharp';
import { createWatermarkedVideoCache, watermarkedVideoPublicOrigin } from '../server/services/create/watermarkedVideoCache.js';
import createCreationExportRoutes from '../server/routes/creationExports.js';

const exec = promisify(execFile);

test('temporary video URLs target the deployment that owns the cache', () => {
	assert.equal(watermarkedVideoPublicOrigin('beta', 'production'), 'https://beta-sh.parascene.com');
	assert.equal(watermarkedVideoPublicOrigin('prod', 'production'), 'https://sh.parascene.com');
});

test('watermarked video is prepared, scoped to its sharer, and expires', async (t) => {
	try { await exec('ffmpeg', ['-version']); await exec('ffprobe', ['-version']); }
	catch { t.skip('ffmpeg and ffprobe required'); return; }
	const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'vynly-cache-test-'));
	let time = Date.now();
	try {
		const source = path.join(fixtureDir, 'source.mp4');
		await exec('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=320x240:d=1.5,fade=t=in:st=0:d=1.5',
			'-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
		const input = await readFile(source);
		const cacheDir = path.join(fixtureDir, 'cache');
		const cache = createWatermarkedVideoCache({ storage: { getVideoBuffer: async () => input }, now: () => time, cacheDir,
			publicOrigin: 'https://sh.parascene.com' });
		const image = { id: 31, filename: '7_31.png', status: 'completed', meta: { media_type: 'video', video: { filename: 'video/test.mp4' } } };
		const started = await cache.prepare({ image, userId: 7 });
		let job;
		for (let attempt = 0; attempt < 100; attempt++) {
			job = cache.get(started.id);
			if (job?.status !== 'preparing') break;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		assert.equal(job?.status, 'ready', job?.error);
		assert.match(cache.preparedUrl(started.id, 7, 31), /^https:\/\/sh\.parascene\.com\/api\/share\/watermarked-video\//);
		assert.throws(() => cache.preparedUrl(started.id, 8, 31), { status: 409 });
		assert.ok((await stat(job.path)).size > 0);
		const probe = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', job.path]);
		assert.ok(Number(probe.stdout) > 1.3, 'watermark overlay must not truncate the clip');
		for (const [at, minExpected, maxExpected] of [['0.1', 100, 140], ['1.4', 230, 240]]) {
			const frame = path.join(fixtureDir, `frame-${at}.png`);
			await exec('ffmpeg', ['-y', '-v', 'error', '-ss', at, '-i', job.path, '-frames:v', '1', frame]);
			const stats = await sharp(frame).extract({ left: 200, top: 190, width: 120, height: 50 }).stats();
			assert.ok(stats.channels[0].min < minExpected && stats.channels[0].max > maxExpected,
				`watermark should contrast with the frame at ${at}s (min ${stats.channels[0].min}, max ${stats.channels[0].max})`);
		}
		const recovered = createWatermarkedVideoCache({ storage: { getVideoBuffer: async () => input }, now: () => time, cacheDir,
			publicOrigin: 'https://sh.parascene.com' });
		await recovered.init();
		assert.equal(recovered.get(started.id)?.status, 'ready', 'prepared copy survives a server restart');
		const app = express();
		app.use((req, _res, next) => { if (req.headers['x-user-id']) req.auth = { userId: Number(req.headers['x-user-id']) }; next(); });
		app.use(createCreationExportRoutes({
			queries: { selectUserById: { get: async () => ({ id: 7 }) }, selectCreatedImageById: { get: async () => image } },
			storage: { getVideoBuffer: async () => input }, watermarkedVideoCache: cache
		}));
		const server = app.listen(0, '127.0.0.1');
		await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
		try {
			const base = `http://127.0.0.1:${server.address().port}`;
			assert.equal((await fetch(`${base}/api/create/images/31/watermarked-video/prepare`, { method: 'POST' })).status, 401);
			const reused = await (await fetch(`${base}/api/create/images/31/watermarked-video/prepare`, {
				method: 'POST', headers: { 'x-user-id': '7' }
			})).json();
			assert.equal(reused.id, started.id, 'preview and Vynly reuse one watermarked copy');
			assert.equal((await fetch(`${base}/api/create/watermarked-video/${started.id}`)).status, 401);
			const status = await (await fetch(`${base}/api/create/watermarked-video/${started.id}`, { headers: { 'x-user-id': '7' } })).json();
			assert.equal(status.status, 'ready');
			const publicPath = new URL(status.url).pathname;
			const media = await fetch(`${base}${publicPath}`, { headers: { Range: 'bytes=0-99' } });
			assert.equal(media.status, 206);
			assert.equal(media.headers.get('content-type'), 'video/mp4');
			assert.equal((await media.arrayBuffer()).byteLength, 100);
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
		time += 2 * 60 * 60 * 1000 + 1;
		await cache.sweep();
		assert.equal(cache.get(started.id), null);
		await assert.rejects(stat(job.path));
	} finally {
		await rm(fixtureDir, { recursive: true, force: true });
	}
});
