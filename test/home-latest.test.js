import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCreationsStore } from '../server/db/creations.js';
import { createHomeLatestStore } from '../server/db/homeLatest.js';
import { createHomeLatestRoutes } from '../server/routes/homeLatest.js';

function clientFor(rows) {
	const calls = [];
	const client = {
		calls,
		from(table) {
			const chain = [];
			const query = new Proxy({
				then(ok, bad) {
					calls.push({ table, chain });
					return Promise.resolve({ data: rows, error: null }).then(ok, bad);
				}
			}, {
				get(target, key) {
					if (key in target) return target[key];
					return (...args) => {
						chain.push([key, ...args]);
						return query;
					};
				}
			});
			return query;
		}
	};
	return client;
}

const rows = [
	{ id: 4, published_at: '2026-11-19T00:00:00.000Z', filename: 'hidden.png', file_path: 'hidden.png', width: 8, height: 8, meta: { media_type: 'image', hidden_in_group: 8 } },
	{ id: 2, published_at: '2026-11-17T00:00:00.000Z', filename: 'still.png', file_path: 'still.png', width: 8, height: 8, meta: { media_type: 'image' } },
	{ id: 6, published_at: '2026-11-15T00:00:00.000Z', filename: 'group/set', file_path: '', width: 8, height: 8, meta: { media_type: 'image', group: { kind: 'group_creations', source_creations: [] } } },
	{ id: 5, published_at: '2026-11-16T00:00:00.000Z', filename: 'song.mp3', file_path: 'song.mp3', width: 8, height: 8, meta: { media_type: 'audio' } },
	{
		id: 30,
		published_at: '2026-11-18T00:00:00.000Z',
		title: 'Clip set',
		filename: 'group_v2/set',
		file_path: '',
		width: 8,
		height: 8,
		meta: {
			group: {
				kind: 'group_v2',
				version: 2,
				items: [{
					cover: true,
					view: { mediaType: 'video', filePath: 'clips/a.mp4', filename: 'a.mp4' },
					pointer: { kind: 'creation', creationId: 9 }
				}]
			}
		}
	}
];

function has(chain, name, column, value) {
	return chain.some((op) => op[0] === name && op[1] === column && (value === undefined || op[2] === value));
}

test('latest published rows are split by type, publish time, and group cover', async () => {
	const client = clientFor(rows);
	const store = createHomeLatestStore(client);
	const images = await store.latestPublished('image', { limit: 8, viewerEnableNsfw: false });
	const videos = await store.latestPublished('video', { limit: 8, viewerEnableNsfw: false });
	const songs = await store.latestPublished('audio', { limit: 8, viewerEnableNsfw: true });
	assert.deepEqual(images.map((row) => row.id), [2, 6]);
	assert.deepEqual(videos.map((row) => row.id), [30]);
	assert.deepEqual(songs.map((row) => row.id), [5]);

	const imageQuery = client.calls[0];
	const imageGroups = client.calls[1];
	assert.equal(imageQuery.table, 'prsn_created_images');
	assert.ok(has(imageQuery.chain, 'eq', 'published', true));
	assert.ok(has(imageQuery.chain, 'not', 'published_at', 'is'));
	assert.ok(has(imageQuery.chain, 'is', 'unavailable_at', null));
	assert.ok(has(imageQuery.chain, 'is', 'meta->>hidden_in_group', null));
	assert.ok(has(imageQuery.chain, 'is', 'meta->>hidden_in_project', null));
	assert.ok(imageQuery.chain.some((op) => op[0] === 'or' && op[1] === 'meta->>media_type.is.null,meta->>media_type.eq.image'));
	assert.ok(imageQuery.chain.some((op) => op[0] === 'or' && op[1] === 'meta->group->>kind.is.null,meta->group->>kind.neq.group_v2'));
	assert.ok(imageQuery.chain.some((op) => op[0] === 'or' && String(op[1]).includes('nsfw')));
	assert.deepEqual(imageQuery.chain.filter((op) => op[0] === 'order'), [
		['order', 'published_at', { ascending: false }],
		['order', 'id', { ascending: false }]
	]);
	assert.deepEqual(imageQuery.chain.at(-1), ['limit', 24]);
	assert.ok(has(imageGroups.chain, 'eq', 'meta->group->>kind', 'group_v2'));
	assert.deepEqual(imageGroups.chain.at(-1), ['limit', 24]);
	assert.ok(client.calls[2].chain.some((op) => op[0] === 'eq' && op[1] === 'meta->>media_type' && op[2] === 'video'));
	assert.equal(client.calls[4].chain.some((op) => op[0] === 'or' && String(op[1]).includes('nsfw')), false);
});

async function withApp(routes, run) {
	const app = express();
	app.use(express.json());
	app.use((req, res, next) => {
		if (req.headers['x-viewer']) req.auth = { userId: 1 };
		next();
	});
	for (const route of routes) app.use(route);
	const server = app.listen(0, '127.0.0.1');
	await new Promise((ok, bad) => {
		server.once('listening', ok);
		server.once('error', bad);
	});
	try {
		await run(`http://127.0.0.1:${server.address().port}`);
	} finally {
		await new Promise((ok) => server.close(ok));
	}
}

test('home latest requires a signed-in viewer and a known media type', async () => {
	const calls = [];
	const homeLatest = {
		latestPublished: async (type, options) => {
			calls.push({ type, options });
			return [{
				id: 7,
				user_id: 2,
				filename: 'a.png',
				file_path: 'a.png',
				width: 10,
				height: 10,
				status: 'completed',
				published: true,
				published_at: '2026-11-01T00:00:00.000Z',
				meta: { media_type: 'image' }
			}];
		}
	};
	const users = { byId: async () => ({ id: 1, meta: { enableNsfw: true } }) };
	await withApp([createHomeLatestRoutes({ homeLatest, users })], async (base) => {
		assert.equal((await fetch(`${base}/api/home/latest?type=image`)).status, 401);
		assert.equal((await fetch(`${base}/api/home/latest?type=project`, { headers: { 'x-viewer': '1' } })).status, 400);
		const result = await fetch(`${base}/api/home/latest?type=video&limit=8`, { headers: { 'x-viewer': '1' } });
		assert.equal(result.status, 200);
		assert.match(result.headers.get('cache-control'), /no-store/);
		const body = await result.json();
		assert.equal(body.items[0].id, 7);
		assert.equal(body.items[0].created_image_id, 7);
		assert.equal(body.items[0].like_count, 0);
		assert.equal(body.items[0].comment_count, 0);
		assert.equal(body.items[0].viewer_liked, false);
		assert.deepEqual(calls, [{ type: 'video', options: { limit: 8, viewerEnableNsfw: true } }]);
	});
});

test('a group is labeled with its cover type on the home row', async () => {
	const homeLatest = {
		latestPublished: async () => [rows.find((row) => row.id === 30)]
	};
	const users = { byId: async () => ({ id: 1, meta: {} }) };
	const creations = { engagementForViewer: async () => ({ 30: { like_count: 4, comment_count: 2, viewer_liked: true } }) };
	await withApp([createHomeLatestRoutes({ homeLatest, users, creations })], async (base) => {
		const body = await (await fetch(`${base}/api/home/latest?type=video`, { headers: { 'x-viewer': '1' } })).json();
		assert.equal(body.items[0].media_type, 'video');
		assert.equal(body.items[0].created_image_id, 30);
		assert.equal(body.items[0].like_count, 4);
		assert.equal(body.items[0].viewer_liked, true);
	});
});

test('newbies follow join order and signup posts stay out of images', async () => {
	const users = [
		Array.from({ length: 40 }, (_, index) => ({ id: 1000 + index, created_at: '2026-11-18T00:00:00.000Z' })),
		[
			{ id: 2, created_at: '2026-11-02T00:00:00.000Z' },
			{ id: 1, created_at: '2026-11-01T00:00:00.000Z' }
		]
	];
	const creations = [
		{ id: 21, user_id: 2, published_at: '2026-11-02T02:00:00.000Z', title: 'Later', filename: 'later.png', meta: { media_type: 'image' } },
		{ id: 22, user_id: 2, published_at: '2026-11-02T01:00:00.000Z', title: 'Profile portrait', filename: 'portrait.png', meta: {} },
		{ id: 11, user_id: 1, published_at: '2026-11-01T01:00:00.000Z', title: 'Welcome @ada', filename: 'welcome_1.png', meta: {} },
		{ id: 31, user_id: 9, published_at: '2026-11-09T01:00:00.000Z', title: 'Welcome @nope', filename: 'welcome_9.png', meta: { new_user: true } }
	];
	let userPage = 0;
	const calls = [];
	const client = {
		calls,
		from(table) {
			const chain = [];
			const query = new Proxy({
				then(ok, bad) {
					calls.push({ table, chain });
					const data = table === 'prsn_users'
						? users[Math.min(userPage++, users.length - 1)]
						: table === 'prsn_user_profiles'
							? [{ user_id: 2, user_name: 'bea' }, { user_id: 1, user_name: 'ada' }]
							: creations;
					return Promise.resolve({ data, error: null }).then(ok, bad);
				}
			}, {
				get(target, key) {
					if (key in target) return target[key];
					return (...args) => {
						chain.push([key, ...args]);
						return query;
					};
				}
			});
			return query;
		}
	};
	const store = createHomeLatestStore(client);
	const people = await store.latestNewUsers({ limit: 12, viewerEnableNsfw: true });
	assert.deepEqual(people.map((row) => row.id), [22, 11]);
	assert.deepEqual(people.map((row) => row.user_name), ['bea', 'ada']);
	assert.equal(calls.filter((call) => call.table === 'prsn_users').length, 2);

	const images = await store.latestPublished('image', { limit: 8, viewerEnableNsfw: true });
	assert.deepEqual(images.map((row) => row.id), [21]);
});

test('home engagement names the people who liked and commented', async () => {
	const tables = {
		prsn_created_image_like_counts: [{ created_image_id: 7, like_count: 2 }],
		prsn_created_image_comment_counts: [{ created_image_id: 7, comment_count: 1 }],
		prsn_likes_created_image: [
			{ created_image_id: 7, user_id: 2, created_at: '2026-11-02' },
			{ created_image_id: 7, user_id: 1, created_at: '2026-11-01' }
		],
		prsn_comments_created_image: [
			{ created_image_id: 7, user_id: 3, created_at: '2026-11-03' },
			{ created_image_id: 7, user_id: 3, created_at: '2026-11-02' }
		],
		prsn_user_profiles: [
			{ user_id: 1, user_name: 'ada' },
			{ user_id: 2, display_name: 'Bea' },
			{ user_id: 3, user_name: 'cy' }
		]
	};
	const client = {
		from(table) {
			const chain = [];
			const query = new Proxy({}, {
				get(_target, key) {
					if (key === 'then') {
						return (ok, bad) => {
							let rows = [...(tables[table] || [])];
							for (const [method, ...args] of chain) {
								if (method === 'eq') rows = rows.filter((row) => row[args[0]] === args[1]);
								if (method === 'in') rows = rows.filter((row) => args[1].includes(row[args[0]]));
							}
							return Promise.resolve({ data: rows, error: null }).then(ok, bad);
						};
					}
					return (...args) => {
						chain.push([key, ...args]);
						return query;
					};
				}
			});
			return query;
		}
	};
	const engagement = await createCreationsStore({ client }).engagementForViewer(1, [7]);
	assert.equal(engagement['7'].viewer_liked, true);
	assert.deepEqual(engagement['7'].liked_by, ['@Bea', '@ada']);
	assert.deepEqual(engagement['7'].commented_by, ['@cy']);
});
