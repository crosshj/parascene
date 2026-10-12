import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createThreadsRoutes } from '../server/routes/threads.js';
import {
	normalizeHashtagSlug,
	parseHashtagSlugFromTagPath,
	resolveSpecialHashtagDestination,
} from '../client/shared/hashtagDestination.js';

test('hashtag helpers normalize specials and /t paths', () => {
	assert.equal(normalizeHashtagSlug(' Video-Games '), 'video-games');
	assert.equal(parseHashtagSlugFromTagPath('/t/video-games'), 'video-games');
	assert.equal(parseHashtagSlugFromTagPath('/p/oceanman'), null);
	assert.deepEqual(resolveSpecialHashtagDestination('feed'), { kind: 'path', href: '/feed' });
	assert.equal(resolveSpecialHashtagDestination('video-games'), null);
});

async function withApp(threads, run) {
	const app = express();
	app.use((req, _res, next) => {
		if (req.headers.authorization === 'Bearer test') req.auth = { userId: 7 };
		next();
	});
	app.use(createThreadsRoutes({ threads }));
	const server = app.listen(0, '127.0.0.1');
	await new Promise((resolve, reject) => {
		server.once('listening', resolve);
		server.once('error', reject);
	});
	try {
		await run(`http://127.0.0.1:${server.address().port}`);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

test('GET /api/chat/hashtag-channel-exists returns channel and tag flags', async () => {
	await withApp(
		{
			hashtagResolve: async (_userId, raw) => ({
				slug: String(raw).toLowerCase(),
				channelExists: String(raw).toLowerCase() === 'video-games',
				tagExists: true,
			}),
		},
		async (origin) => {
			assert.equal((await fetch(`${origin}/api/chat/hashtag-channel-exists/video-games`)).status, 401);
			const res = await fetch(`${origin}/api/chat/hashtag-channel-exists/video-games`, {
				headers: { Authorization: 'Bearer test' },
			});
			assert.equal(res.status, 200);
			assert.deepEqual(await res.json(), {
				slug: 'video-games',
				channelExists: true,
				tagExists: true,
			});
		}
	);
});
