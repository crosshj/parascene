import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createCreationsRoutes, serializeCreation } from '../routes/creations.js';
import { creationMediaKeys } from '../db/creations.js';

test('group detail serializes child thumbnails with parent access for legacy and v2 groups', () => {
	const legacy = { id: 42, meta: { group: { kind: 'group_creations', source_creations: [
		{ id: 1, file_path: '/api/images/created/one.png?creation_id=1' },
		{ id: 2, file_path: '/api/creations/media/two.png?creation_id=2', meta: { media_type: 'video', video: { file_path: '/api/videos/created/video/two.mp4' } } }
	] } } };
	const v2 = { id: 42, meta: { group: { kind: 'group_v2', items: [
		{ pointer: { kind: 'creation', creationId: 1 }, view: { filePath: '/api/images/created/one.png', mediaType: 'image' }, cover: true },
		{ pointer: { kind: 'creation', creationId: 2 }, view: { filePath: '/api/creations/media/two.png', mediaType: 'video', videoUrl: '/api/videos/created/video/two.mp4' } }
	] } } };
	for (const row of [legacy, v2]) {
		const before = structuredClone(row);
		const payload = serializeCreation(row);
		assert.equal(payload.meta.group.kind, 'group_creations');
		const children = payload.meta.group.source_creations;
		assert.equal(children.length, 2);
		assert.equal(children[0].thumbnail_url, '/api/creations/media/one.png?creation_id=42&variant=thumbnail');
		assert.equal(children[1].thumbnail_url, '/api/creations/media/video/two.mp4?creation_id=42&variant=video_thumbnail');
		assert.equal(children[1].meta.video.file_path, '/api/creations/media/video/two.mp4?creation_id=42');
		assert.deepEqual(creationMediaKeys(row).sort(), ['one.png', 'two.png', 'video/two.mp4']);
		assert.deepEqual(row, before);
	}
});

async function withApp(run, { mediaResponse, canAccessMedia = async () => true, fetchMedia, signedPlaybackUrl } = {}) {
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
		lineageAncestorForViewer: async (_userId, id, parentId) => Number(id) === 31884 && Number(parentId) === row.id
			? { ...row, id: 31884, published: false }
			: null,
		nsfwFlags: async (ids) => Object.fromEntries(ids.map((id) => [String(id), Number(id) === 31884])),
		likeMeta: async () => ({ like_count: 2, viewer_liked: true, liked_by: ['@creator', '@friend'] }),
		setLiked: async (_userId, _creationId, liked) => ({ like_count: liked ? 2 : 1, viewer_liked: liked, liked_by: liked ? ['@creator', '@friend'] : ['@friend'] }),
		comments: async () => ({ commentCount: 1, rows: [{ id: 7, user_id: 42, text: 'hello', reactions: {}, viewer_reactions: [] }] }),
		related: async () => ({ rows: [{ ...row, id: 31921, published: true }], hasMore: false }),
		canAccessMedia,
		safeKey: (key) => key,
		fetchMedia: fetchMedia || (async () => mediaResponse || new Response('media')),
		signedPlaybackUrl,
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

test('creation detail dependent APIs expose likes, comments, lineage, flags, and related creations', async () => {
	await withApp(async (origin) => {
		const headers = { Authorization: 'Bearer test' };
		const [likes, activity, lineage, flags, related] = await Promise.all([
			fetch(`${origin}/api/created-images/31885/like`, { headers }).then((res) => res.json()),
			fetch(`${origin}/api/created-images/31885/activity?order=asc&limit=50&offset=0`, { headers }).then((res) => res.json()),
			fetch(`${origin}/api/create/images/31884?lineage_of=31885`, { headers }).then((res) => res.json()),
			fetch(`${origin}/api/creations/nsfw-flags?ids=31884,31885`, { headers }).then((res) => res.json()),
			fetch(`${origin}/api/creations/31885/related?limit=40`, { headers }).then((res) => res.json())
		]);
		assert.equal(likes.like_count, 2);
		assert.equal(activity.items[0].type, 'comment');
		assert.equal(activity.comment_count, 1);
		assert.equal(lineage.id, 31884);
		assert.match(lineage.thumbnail_url, /lineage_of=31885/);
		assert.equal(flags['31884'], true);
		assert.equal(related.items[0].created_image_id, 31921);
		assert.equal(related.hasMore, false);
	});
});

test('creation likes can be toggled through the www-compatible route', async () => {
	await withApp(async (origin) => {
		const headers = { Authorization: 'Bearer test' };
		const liked = await fetch(`${origin}/api/created-images/31885/like`, { method: 'POST', headers }).then((res) => res.json());
		const unliked = await fetch(`${origin}/api/created-images/31885/like`, { method: 'DELETE', headers }).then((res) => res.json());
		assert.equal(liked.viewer_liked, true);
		assert.equal(unliked.viewer_liked, false);
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

test('creation video playback redirects to storage after the access check', async () => {
	let fetched = false;
	await withApp(async (origin) => {
		const headers = { Authorization: 'Bearer test' };
		const target = 'https://example.supabase.co/storage/v1/object/sign/clip.mp4?token=abc';
		for (const method of ['GET', 'HEAD']) {
			const response = await fetch(`${origin}/api/videos/created/video/clip.mp4?creation_id=31885`, {
				method,
				headers,
				redirect: 'manual',
			});
			assert.equal(response.status, 302);
			assert.equal(response.headers.get('location'), target);
			assert.match(response.headers.get('cache-control'), /no-store/);
		}
		const image = await fetch(`${origin}/api/images/created/creation.png?creation_id=31885`, { headers });
		assert.equal(image.status, 200);
		assert.equal(await image.text(), 'still-proxied');
	}, {
		signedPlaybackUrl: async (key) => key === 'video/clip.mp4'
			? 'https://example.supabase.co/storage/v1/object/sign/clip.mp4?token=abc'
			: null,
		fetchMedia: async () => {
			fetched = true;
			return new Response('still-proxied', { status: 200, headers: { 'Content-Type': 'image/png' } });
		},
	});
	assert.equal(fetched, true);
});

test('feed video URLs serve authenticated GET and HEAD through the range-capable media handler', async () => {
	const key = 'video/19_32279_1791193625600_ya7ofo0.mp4';
	const calls = [];
	await withApp(async (origin) => {
		const url = `${origin}/api/videos/created/${key}?creation_id=32279`;
		assert.equal((await fetch(url)).status, 401);
		for (const method of ['GET', 'HEAD']) {
			const response = await fetch(url, {
				method,
				headers: { Authorization: 'Bearer test', Range: 'bytes=0-3' },
			});
			assert.equal(response.status, 206);
			assert.equal(response.headers.get('content-type'), 'video/mp4');
			assert.equal(response.headers.get('content-range'), 'bytes 0-3/1000');
			assert.equal(response.headers.get('accept-ranges'), 'bytes');
			assert.equal(await response.text(), method === 'HEAD' ? '' : 'clip');
		}
	}, {
		canAccessMedia: async (viewerId, creationId, mediaKey) => {
			assert.equal(viewerId, 42);
			assert.equal(creationId, '32279');
			assert.equal(mediaKey, key);
			return true;
		},
		fetchMedia: async (mediaKey, options) => {
			calls.push({ mediaKey, method: options.method, range: options.range });
			return new Response(options.method === 'HEAD' ? null : 'clip', {
				status: 206,
				headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4', 'Content-Range': 'bytes 0-3/1000', 'Accept-Ranges': 'bytes' },
			});
		},
	});
	assert.deepEqual(calls, ['GET', 'HEAD'].map(method => ({ mediaKey: key, method, range: 'bytes=0-3' })));
});
