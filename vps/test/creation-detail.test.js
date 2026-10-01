import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createCreationsRoutes } from '../routes/creations.js';

async function withApp(run, { mediaResponse } = {}) {
	const row = {
		id: 31885,
		user_id: 42,
		filename: 'creation.png',
		file_path: '42/creation.png',
		status: 'completed',
		published: false,
		meta: {},
	};
	const creations = {
		byIdForViewer: async (userId, id) => Number(userId) === 42 && Number(id) === row.id ? row : null,
		canAccessMedia: async () => true,
		safeKey: (key) => key,
		fetchMedia: async () => mediaResponse || new Response('media'),
	};
	const users = {
		byId: async () => ({ id: 42, email: 'creator@example.com', role: 'consumer', meta: {} }),
		profileByUserId: async () => ({ user_id: 42, user_name: 'creator', display_name: 'Creator', avatar_url: null }),
	};
	const app = express();
	app.use((req, _res, next) => { if (req.headers.authorization === 'Bearer test') req.auth = { userId: 42 }; next(); });
	app.use(createCreationsRoutes({ creations, users }));
	const server = app.listen(0);
	try { await run(`http://127.0.0.1:${server.address().port}`); }
	finally { await new Promise((resolve) => server.close(resolve)); }
}

test('creation detail uses the canonical VPS creation endpoint', async () => {
	await withApp(async (origin) => {
		const response = await fetch(`${origin}/api/creations/31885`, { headers: { Authorization: 'Bearer test' } });
		assert.equal(response.status, 200);
		const creation = await response.json();
		assert.equal(creation.id, 31885);
		assert.equal(creation.creator.user_name, 'creator');
		assert.deepEqual(creation.lineage_descendants, []);
	});
});

test('creation detail rejects missing creations and unauthenticated viewers', async () => {
	await withApp(async (origin) => {
		const missing = await fetch(`${origin}/api/creations/999`, { headers: { Authorization: 'Bearer test' } });
		assert.equal(missing.status, 404);
		const unauthenticated = await fetch(`${origin}/api/creations/31885`);
		assert.equal(unauthenticated.status, 401);
	});
});

test('creation video media preserves partial-content status and range headers', async () => {
	const bytes = Buffer.from('video-chunk');
	const mediaResponse = new Response(bytes, {
		status: 206,
		headers: {
			'Content-Type': 'video/mp4',
			'Content-Length': String(bytes.length),
			'Content-Range': `bytes 0-${bytes.length - 1}/1000`,
			'Accept-Ranges': 'bytes',
		},
	});

	await withApp(async (origin) => {
		const response = await fetch(`${origin}/api/creations/media/42%2Fvideo.mp4?creation_id=31885`, {
			headers: { Authorization: 'Bearer test', Range: 'bytes=0-10' },
		});
		assert.equal(response.status, 206);
		assert.equal(response.headers.get('content-type'), 'video/mp4');
		assert.equal(response.headers.get('content-range'), `bytes 0-${bytes.length - 1}/1000`);
		assert.equal(response.headers.get('accept-ranges'), 'bytes');
		assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
	}, { mediaResponse });
});
