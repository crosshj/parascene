import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createCreationsRoutes } from '../routes/creations.js';

async function withApp(run) {
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
