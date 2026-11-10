import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import createVynlyRoutes from '../server/routes/vynly.js';
import { createVynlyClient, VynlyApiError } from '../server/services/vynly/vynlyClient.js';
import { getVynlyBearerToken, isVynlyConfiguredForUser } from '../server/services/vynly/vynlyAuth.js';
import {
	normalizeDeclaredSource,
	normalizeVideoDeclaredSource,
	shareCreationToVynly
} from '../server/services/vynly/vynlyShareFromCreation.js';
import { creationRowIsVideo } from '../server/services/create/creationMedia.js';

async function withApp(deps, run) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		if (req.headers['x-user-id']) req.auth = { userId: Number(req.headers['x-user-id']) };
		next();
	});
	app.use(createVynlyRoutes(deps));
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

test('vynlyAuth reads token from user meta only', () => {
	assert.equal(getVynlyBearerToken({ user: null }), null);
	assert.equal(isVynlyConfiguredForUser({ id: 1, meta: {} }), false);
	assert.equal(isVynlyConfiguredForUser({ id: 1, meta: { vynlyBearerToken: '  abc  ' } }), true);
	assert.equal(getVynlyBearerToken({ user: { meta: { vynlyBearerToken: '  abc  ' } } }), 'abc');
});

test('normalizeDeclaredSource and creationRowIsVideo', () => {
	assert.equal(normalizeDeclaredSource('Flux'), 'flux');
	assert.equal(normalizeDeclaredSource('nope'), 'other');
	assert.equal(normalizeVideoDeclaredSource('Veo'), 'veo');
	assert.equal(normalizeVideoDeclaredSource('flux'), 'other');
	assert.equal(creationRowIsVideo(null), false);
	assert.equal(creationRowIsVideo({ video: { file_path: '/x.mp4' } }), true);
	assert.equal(creationRowIsVideo({ file_path: '/api/videos/created/a.mp4' }), true);
	assert.equal(creationRowIsVideo({ file_path: '/api/images/created/a.png' }), false);
	assert.equal(creationRowIsVideo({ video_filename: 'video/x.mp4' }), true);
	assert.equal(creationRowIsVideo({ media_type: 'video' }), true);
});

test('createVynlyClient forwards auth and throws on non-OK', async () => {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url, init });
		return new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	};
	const client = createVynlyClient({ baseUrl: 'https://example.test', fetchImpl });
	const data = await client.getPosts('tok', { limit: 3, before: '9' });
	await client.postVideo('tok', { videoUrl: 'https://example.test/a.mp4', declaredSource: 'veo' });
	assert.equal(calls.at(-1).url, 'https://example.test/api/posts');
	assert.equal(calls.at(-1).init.method, 'POST');
	assert.equal(JSON.parse(calls.at(-1).init.body).declaredSource, 'veo');
	assert.equal(data.ok, true);
	const u = new URL(calls[0].url);
	assert.equal(`${u.origin}${u.pathname}`, 'https://example.test/api/posts');
	assert.equal(u.searchParams.get('limit'), '3');
	assert.equal(calls[0].init.headers.get('Authorization'), 'Bearer tok');

	const bad = createVynlyClient({
		baseUrl: 'https://example.test',
		fetchImpl: async () => new Response('nope', { status: 429 })
	});
	await assert.rejects(() => bad.getSparks('t'), (err) => err instanceof VynlyApiError && err.status === 429);
});

test('GET /api/vynly/status requires auth and reports configured', async () => {
	const user = { id: 7, meta: { vynlyBearerToken: 'secret' } };
	await withApp(
		{
			queries: {
				selectUserById: { get: async (id) => (Number(id) === 7 ? user : null) }
			},
			storage: {}
		},
		async (origin) => {
			assert.equal((await fetch(`${origin}/api/vynly/status`)).status, 401);
			const res = await fetch(`${origin}/api/vynly/status`, { headers: { 'x-user-id': '7' } });
			assert.equal(res.status, 200);
			assert.deepEqual(await res.json(), { configured: true });
		}
	);
});

test('POST /api/vynly/share-from-creation requires token and valid creationId', async () => {
	const bareUser = { id: 3, role: 'consumer', meta: {} };
	await withApp(
		{
			queries: {
				selectUserById: { get: async () => bareUser }
			},
			storage: {}
		},
		async (origin) => {
			const noToken = await fetch(`${origin}/api/vynly/share-from-creation`, {
				method: 'POST',
				headers: { 'x-user-id': '3', 'Content-Type': 'application/json' },
				body: JSON.stringify({ creationId: 1 })
			});
			assert.equal(noToken.status, 503);
			assert.match((await noToken.json()).error, /not configured/i);
		}
	);

	const configured = { id: 3, role: 'consumer', meta: { vynlyBearerToken: 'tok' } };
	await withApp(
		{
			queries: {
				selectUserById: { get: async () => configured }
			},
			storage: {}
		},
		async (origin) => {
			const badId = await fetch(`${origin}/api/vynly/share-from-creation`, {
				method: 'POST',
				headers: { 'x-user-id': '3', 'Content-Type': 'application/json' },
				body: JSON.stringify({ creationId: 0 })
			});
			assert.equal(badId.status, 400);
		}
	);
});

test('shareCreationToVynly posts a public video URL and multipart images', async () => {
	const png = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
		'base64'
	);
	const videoRow = {
		id: 11,
		filename: '1_11_1_a.png',
		status: 'completed',
		width: 64,
		height: 64,
		meta: { media_type: 'video', video: { filename: 'video/x.mp4', file_path: '/api/videos/created/video/x.mp4' } }
	};
	let videoPost = null;
	const videoCache = { preparedUrl: (id, userId, creationId) => {
		assert.equal(id, 'prepared-11');
		assert.equal(userId, 1);
		assert.equal(creationId, 11);
		return 'https://sh.parascene.com/api/share/watermarked-video/prepared-11';
	}, get: () => ({ duration: 12, outputBytes: 2_000_000 }) };
	await shareCreationToVynly({
		queries: { selectCreatedImageById: { get: async () => videoRow } },
		storage: { getImageBuffer: async () => { throw new Error('Video should not read image buffer'); } },
		user: { id: 1 },
		creationId: 11,
		options: { declaredSource: 'veo', preparedVideoId: 'prepared-11' },
		client: { postVideo: async (_token, body) => { videoPost = body; return { id: 98 }; } },
		videoCache,
		token: 'tok'
	});
	assert.equal(videoPost.videoUrl, 'https://sh.parascene.com/api/share/watermarked-video/prepared-11');
	assert.equal(videoPost.declaredSource, 'veo');
	assert.equal(videoPost.tags, 'parascene,aivideo');
	await assert.rejects(() => shareCreationToVynly({
		queries: { selectCreatedImageById: { get: async () => videoRow } },
		user: { id: 1 }, creationId: 11, options: { preparedVideoId: 'prepared-11' },
		videoCache: { ...videoCache, get: () => ({ duration: 61, outputBytes: 2_000_000 }) },
		client: { postVideo: async () => { throw new Error('Should not post'); } }, token: 'tok'
	}), (err) => err.status === 400 && /60 seconds/.test(err.message));

	await assert.rejects(() => shareCreationToVynly({
		queries: { selectCreatedImageById: { get: async () => videoRow } },
		user: { id: 1 }, creationId: 11, options: { preparedVideoId: 'bad' },
		videoCache: { preparedUrl: () => { throw Object.assign(new Error('Not ready'), { status: 409 }); } },
		client: { postVideo: async () => { throw new Error('Should not post'); } }, token: 'tok'
	}), (err) => err.status === 409);

	const imageRow = {
		id: 12,
		filename: '1_12_1_a.png',
		status: 'completed',
		width: 64,
		height: 64,
		title: 'Hello',
		meta: {}
	};
	let posted = null;
	const client = {
		async postImageMultipart(_token, fields) {
			posted = fields;
			return { id: 99, url: 'https://vynly.co/?post=99' };
		}
	};
	const result = await shareCreationToVynly({
		queries: {
			selectCreatedImageById: { get: async () => imageRow }
		},
		storage: { getImageBuffer: async () => png },
		user: { id: 1 },
		creationId: 12,
		options: { declaredSource: 'flux' },
		client,
		token: 'tok'
	});
	assert.equal(result.id, 99);
	assert.ok(posted);
	assert.equal(posted.declaredSource, 'flux');
	assert.match(posted.caption, /Hello/);
	assert.ok(Buffer.isBuffer(posted.buffer));
});
