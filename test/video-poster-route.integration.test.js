import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import sharp from 'sharp';
import createCreateRoutes from '../server/routes/create.js';

function videoRow(overrides = {}) {
	return {
		id: 9,
		user_id: 7,
		status: 'completed',
		filename: 'still.png',
		file_path: '/api/images/created/still.png',
		width: 1024,
		height: 1024,
		color: null,
		meta: {
			media_type: 'video',
			method: 'image2video',
			video: { file_path: '/api/videos/created/clip.mp4' },
			args: { aspect_ratio: '16:9', image_url: 'https://example.com/a.png' },
		},
		...overrides,
	};
}

async function fixture(run) {
	const rows = new Map([
		[9, videoRow()],
		[10, videoRow({
			id: 10,
			meta: { media_type: 'video', method: 'text2video', group: { kind: 'group_creations' }, video: { file_path: '/api/videos/created/g.mp4' } },
		})],
		[11, { id: 11, user_id: 7, status: 'completed', filename: 'pic.png', file_path: '/api/images/created/pic.png', meta: { media_type: 'image' } }],
	]);
	const uploaded = [];
	const queries = {
		selectUserById: { get: async (id) => ({ id, role: id === 1 ? 'admin' : 'consumer' }) },
		selectCreatedImageById: { get: async (id, owner) => { const row = rows.get(Number(id)); return row?.user_id === owner ? row : null; } },
		selectCreatedImageByIdAnyUser: { get: async (id) => rows.get(Number(id)) || null },
		updateCreatedImageJobCompleted: { run: async (id, owner, payload) => { const row = rows.get(Number(id)); if (!row || row.user_id !== owner) return { changes: 0 }; Object.assign(row, payload); return { changes: 1 }; } },
	};
	const storage = {
		uploadImage: async (_buffer, filename) => { uploaded.push(filename); return `/api/images/created/${filename}`; },
	};
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => { const id = Number(req.headers['x-test-user']); if (id) req.auth = { userId: id }; next(); });
	app.use(createCreateRoutes({ queries, storage, canUseServer: async () => true }));
	const server = app.listen(0, '127.0.0.1');
	await new Promise((resolve) => server.once('listening', resolve));
	const base = `http://127.0.0.1:${server.address().port}`;
	const request = async (path, { user = 7, form } = {}) => {
		const headers = {};
		if (user) headers['x-test-user'] = String(user);
		const res = await fetch(base + path, { method: 'POST', headers, body: form });
		return { status: res.status, data: await res.json() };
	};
	try { await run({ request, rows, uploaded }); }
	finally { await new Promise((resolve) => server.close(resolve)); }
}

async function pngForm(width, height) {
	const png = await sharp({ create: { width, height, channels: 3, background: { r: 20, g: 40, b: 80 } } }).png().toBuffer();
	const form = new FormData();
	form.append('image', new Blob([png], { type: 'image/png' }), 'frame.png');
	form.append('video_width', String(width));
	form.append('video_height', String(height));
	return form;
}

test('video poster upload works for image-to-video and rejects non-video rows', async () => {
	await fixture(async ({ request, rows, uploaded }) => {
		assert.equal((await request('/api/create/images/9/video-placeholder', { user: 0, form: await pngForm(32, 32) })).status, 401);
		assert.equal((await request('/api/create/images/11/video-placeholder', { form: await pngForm(32, 32) })).status, 400);
		assert.equal((await request('/api/create/images/10/video-placeholder', { form: await pngForm(32, 32) })).status, 400);
		assert.equal((await request('/api/create/images/9/video-placeholder', { user: 8, form: await pngForm(32, 32) })).status, 403);

		const saved = await request('/api/create/images/9/video-placeholder', { form: await pngForm(640, 360) });
		assert.equal(saved.status, 200);
		assert.equal(saved.data.ok, true);
		assert.equal(saved.data.width, 640);
		assert.equal(saved.data.height, 360);
		assert.equal(rows.get(9).meta.video_placeholder_manual, true);
		assert.equal(rows.get(9).meta.media_type, 'video');
		assert.equal(uploaded.length, 1);
	});
});
