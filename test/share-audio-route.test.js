import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import createCreateRoutes from '../server/routes/create.js';
import { saveShareAudioFromVideo } from '../server/services/create/shareAudio.js';

function videoRow(overrides = {}) {
	return {
		id: 9,
		user_id: 7,
		status: 'completed',
		published: false,
		title: 'Clip',
		filename: 'still.png',
		file_path: '/api/images/created/still.png',
		meta: {
			media_type: 'video',
			video: { file_path: '/api/videos/created/video/clip.mp4' },
		},
		...overrides,
	};
}

function harness() {
	const rows = new Map([
		[9, videoRow()],
		[10, videoRow({
			id: 10,
			published: true,
			meta: {
				media_type: 'video',
				video: { file_path: '/api/videos/created/video/pub.mp4' },
				share_audio: {
					key: 'share-audio/existing.m4a',
					file_path: '/api/images/generic/share-audio/existing.m4a',
					content_type: 'audio/mp4',
				},
			},
		})],
		[11, videoRow({
			id: 11,
			meta: { media_type: 'video', group: { kind: 'group_creations' }, video: { file_path: '/api/videos/created/video/g.mp4' } },
		})],
	]);
	const uploaded = [];
	const clips = [];
	const videoReads = [];
	const queries = {
		selectUserById: { get: async (id) => ({ id, role: id === 1 ? 'admin' : 'consumer' }) },
		selectCreatedImageById: { get: async (id, owner) => { const row = rows.get(Number(id)); return row?.user_id === owner ? row : null; } },
		selectCreatedImageByIdAnyUser: { get: async (id) => rows.get(Number(id)) || null },
		updateCreatedImageMeta: { run: async (id, owner, meta) => { const row = rows.get(Number(id)); if (!row || row.user_id !== owner) return { changes: 0 }; row.meta = meta; return { changes: 1 }; } },
		selectAudioClipByStorageKey: { get: async (key) => (key === 'share-audio/existing.m4a' ? { id: 1, storage_key: key } : null) },
		insertAudioClip: { run: async (row) => { clips.push(row); return row; } },
	};
	const storage = {
		getVideoBuffer: async (key) => { videoReads.push(key); return Buffer.from('video'); },
		uploadGenericImage: async (buffer, key) => { uploaded.push({ key, bytes: buffer.length }); return key; },
	};
	return { rows, uploaded, clips, videoReads, queries, storage };
}

async function withRoute(deps, run) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => { const id = Number(req.headers['x-test-user']); if (id) req.auth = { userId: id }; next(); });
	app.use(createCreateRoutes({ queries: deps.queries, storage: deps.storage, canUseServer: async () => true }));
	const server = app.listen(0, '127.0.0.1');
	await new Promise((resolve) => server.once('listening', resolve));
	const base = `http://127.0.0.1:${server.address().port}`;
	const request = async (path, { user = 7 } = {}) => {
		const headers = { 'content-type': 'application/json' };
		if (user) headers['x-test-user'] = String(user);
		const res = await fetch(base + path, { method: 'POST', headers, body: '{}' });
		return { status: res.status, data: await res.json() };
	};
	try { await run(request); }
	finally { await new Promise((resolve) => server.close(resolve)); }
}

test('share audio is extracted from the stored video, not an uploaded blob', async () => {
	const deps = harness();
	await withRoute(deps, async (request) => {
		assert.equal((await request('/api/create/images/9/share-audio', { user: 0 })).status, 401);
		assert.equal((await request('/api/create/images/9/share-audio', { user: 8 })).status, 403);
		assert.equal((await request('/api/create/images/11/share-audio')).status, 400);

		const existing = await request('/api/create/images/10/share-audio', { user: 8 });
		assert.equal(existing.status, 200);
		assert.equal(existing.data.already_exists, true);
		assert.equal(existing.data.audio_url, '/api/images/generic/share-audio/existing.m4a');
		assert.equal(deps.videoReads.length, 0);
	});

	const saved = await saveShareAudioFromVideo({
		...deps,
		user: { id: 7, role: 'consumer' },
		creationId: 9,
		extractAudio: async (input) => {
			assert.equal(input.toString(), 'video');
			return { buffer: Buffer.from('audio'), contentType: 'audio/mp4', durationSec: 3.5 };
		},
	});
	assert.equal(saved.ok, true);
	assert.match(saved.audio_url, /^\/api\/images\/generic\/share-audio\/7_9_\d+_[a-z0-9]+\.m4a$/);
	assert.equal(deps.videoReads[0], 'video/clip.mp4');
	assert.equal(deps.uploaded.length, 1);
	assert.equal(deps.uploaded[0].bytes, 5);
	assert.equal(deps.rows.get(9).meta.share_audio.content_type, 'audio/mp4');
	assert.equal(deps.rows.get(9).meta.share_audio.duration_sec, 3.5);
	assert.equal(deps.clips.length, 1);
	assert.equal(deps.clips[0].source_type, 'video_extract');
	assert.equal(deps.clips[0].source_created_image_id, 9);
});
