import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import sharp from 'sharp';
import createCreateRoutes from '../routes/create.js';

function audioRow() {
	return {
		id: 5,
		user_id: 7,
		status: 'completed',
		filename: 'old.png',
		file_path: '/api/images/created/old.png',
		width: 1024,
		height: 1024,
		color: null,
		meta: { media_type: 'audio', audio: { cdn_id: 'track' }, cover_source: 'procedural' },
	};
}

async function fixture(run, { servers = [], credits = { balance: 10 } } = {}) {
	const rows = new Map([[5, audioRow()], [6, { id: 6, user_id: 7, status: 'completed', filename: 'pic.png', file_path: '/api/images/created/pic.png', meta: { media_type: 'image' } }]]);
	const uploaded = [];
	const queries = {
		selectUserById: { get: async (id) => ({ id, role: 'consumer', email: 'owner@example.com' }) },
		selectCreatedImageById: { get: async (id, owner) => { const row = rows.get(Number(id)); return row?.user_id === owner ? row : null; } },
		selectCreatedImageByIdAnyUser: { get: async (id) => rows.get(Number(id)) || null },
		selectActiveServers: { all: async () => servers },
		selectUserCredits: { get: async () => credits },
		updateCreatedImageMeta: { run: async (id, owner, meta) => { const row = rows.get(Number(id)); if (!row || row.user_id !== owner) return { changes: 0 }; row.meta = meta; return { changes: 1 }; } },
		updateCreatedImageJobCompleted: { run: async (id, owner, payload) => { const row = rows.get(Number(id)); if (!row || row.user_id !== owner) return { changes: 0 }; Object.assign(row, payload); return { changes: 1 }; } },
		updateUserCreditsBalance: { run: async () => { throw new Error('credits should not change in this test'); } },
	};
	const storage = {
		uploadImage: async (_buffer, filename) => { uploaded.push(filename); return `/api/images/created/${filename}`; },
		getImageBuffer: async () => null,
	};
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => { const id = Number(req.headers['x-test-user']); if (id) req.auth = { userId: id }; next(); });
	app.use(createCreateRoutes({ queries, storage, canUseServer: async () => true }));
	const server = app.listen(0, '127.0.0.1');
	await new Promise((resolve) => server.once('listening', resolve));
	const base = `http://127.0.0.1:${server.address().port}`;
	const request = async (path, { method = 'POST', user = 7, body, form } = {}) => {
		const headers = {};
		if (user) headers['x-test-user'] = String(user);
		let payload;
		if (form) payload = form;
		else if (body !== undefined) {
			headers['content-type'] = 'application/json';
			payload = JSON.stringify(body);
		}
		const res = await fetch(base + path, { method, headers, body: payload });
		return { status: res.status, data: await res.json() };
	};
	try { await run({ request, rows, uploaded }); }
	finally { await new Promise((resolve) => server.close(resolve)); }
}

test('cover query and updates require an owned completed audio creation', async () => {
	await fixture(async ({ request }) => {
		assert.equal((await request('/api/create/images/5/cover/query', { user: 0, body: {} })).status, 401);
		assert.equal((await request('/api/create/images/6/cover/query', { body: {} })).status, 400);
		const query = await request('/api/create/images/5/cover/query', { body: { prompt: 'night drive' } });
		assert.equal(query.status, 200);
		assert.equal(query.data.supported, false);
		const badUrl = await request('/api/create/images/5/cover', { body: { mode: 'url', url: 'not a url' } });
		assert.equal(badUrl.status, 400);
		assert.match(badUrl.data.message, /image URL or a creation link/i);
		const generate = await request('/api/create/images/5/cover', { body: { mode: 'generate', prompt: 'night drive' } });
		assert.equal(generate.status, 400);
		assert.match(generate.data.error, /no image server/i);
	});
});

test('cover upload and reset replace the still and keep the creation completed', async () => {
	await fixture(async ({ request, rows, uploaded }) => {
		const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 12, g: 90, b: 180 } } }).png().toBuffer();
		const form = new FormData();
		form.append('image', new Blob([png], { type: 'image/png' }), 'cover.png');
		const uploadedCover = await request('/api/create/images/5/cover', { form });
		assert.equal(uploadedCover.status, 200);
		assert.equal(uploadedCover.data.cover_source, 'upload');
		assert.equal(rows.get(5).status, 'completed');
		assert.equal(rows.get(5).meta.cover_source, 'upload');
		assert.equal(rows.get(5).meta.media_type, 'audio');
		assert.equal(uploaded.length, 1);

		const reset = await request('/api/create/images/5/cover', { body: { mode: 'reset' } });
		assert.equal(reset.status, 200);
		assert.equal(reset.data.reset, true);
		assert.equal(rows.get(5).meta.cover_source, 'procedural');
		assert.equal(rows.get(5).status, 'completed');
		assert.equal(uploaded.length, 2);
	});
});
