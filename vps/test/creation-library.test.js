import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import createCreateRoutes from '../routes/create.js';
import { createCreateStore } from '../db/create.js';
import { deleteCreationEmbedding } from '../services/create/deleteCreationEmbedding.js';

async function fixture(run) {
 const rows = new Map([1,2,3].map(id => [id, { id, user_id: 7, status: 'completed', filename: `${id}.png`, file_path: `/api/images/created/${id}.png`, width: 800, height: 600, created_at: '2026-10-01T00:00:00Z', meta: {}, published: false }]));
 const calls = [];
 const queries = {
  selectUserById: { get: async id => ({ id, role: id === 99 ? 'admin' : 'consumer' }) },
  selectCreatedImageById: { get: async (id, owner) => { const row = rows.get(Number(id)); return row?.user_id === owner ? row : null; } },
  selectCreatedImageByIdAnyUser: { get: async id => rows.get(Number(id)) },
  selectPolicyByKey: { get: async () => null },
  markCreatedImageUnavailable: { run: async (id, owner) => { calls.push(['soft', Number(id), owner]); rows.get(Number(id)).unavailable_at = new Date().toISOString(); return { changes: 1 }; } },
  unmarkCreatedImageUnavailable: { run: async (id, owner) => { calls.push(['restore', Number(id), owner]); rows.get(Number(id)).unavailable_at = null; return { changes: 1 }; } },
  deleteFeedItemByCreatedImageId: { run: async id => { calls.push(['feed', id]); } },
  deleteAllLikesForCreatedImage: { run: async id => { calls.push(['likes', id]); } },
  deleteAllCommentsForCreatedImage: { run: async id => { calls.push(['comments', id]); } },
  deleteCreatedImageById: { run: async (id, owner) => { calls.push(['permanent', Number(id), owner]); rows.delete(Number(id)); return { changes: 1 }; } },
  insertCreatedImage: { run: async (owner, filename, file_path, width, height, color, status, meta) => { const id = 10; rows.set(id, { id, user_id: owner, filename, file_path, width, height, color, status, meta }); return { insertId: id }; } },
  updateCreatedImageGroupCover: { run: async (id, owner, payload) => { assert.equal(rows.get(id).user_id, owner); Object.assign(rows.get(id), payload); return { changes: 1 }; } },
  updateCreatedImageMeta: { run: async (id, owner, meta) => { assert.equal(rows.get(id).user_id, owner); rows.get(id).meta = meta; return { changes: 1 }; } },
  updateCreatedImage: { run: async (id, owner, title, description, isAdmin = false) => { const row = rows.get(Number(id)); if (!row || (!isAdmin && row.user_id !== owner)) return { changes: 0 }; row.title = title; row.description = description; calls.push(['update', Number(id), title, description]); return { changes: 1 }; } },
  selectFeedItemByCreatedImageId: { get: async id => rows.get(Number(id))?.published ? { id, created_image_id: Number(id) } : undefined },
  updateFeedItem: { run: async (id, title, summary) => { calls.push(['feed-title', id, title, summary]); return { changes: 1 }; } },
 };
 const storage = { getImageUrl: name => `/api/images/created/${name}`, deleteImage: async name => { calls.push(['storage', name]); } };
 const app = express(); app.use(express.json());
 app.use((req, _res, next) => { const id = Number(req.headers['x-test-user']); if (id) req.auth = { userId: id }; next(); });
 app.use(createCreateRoutes({ queries, storage }));
 const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
 const request = async (method, path, body, user = 7) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/create/images${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-test-user': String(user) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: await res.json() };
 };
 try { await run({ request, rows, calls, queries }); }
 finally { await new Promise(resolve => server.close(resolve)); }
}

test('owner delete is authenticated and soft, retains objects, and removes feed entry', async () => {
 await fixture(async ({ request, rows, calls }) => {
  assert.equal((await request('DELETE', '/1', null, 0)).status, 401);
  assert.equal((await request('DELETE', '/1', null, 8)).status, 404);
  assert.equal((await request('DELETE', '/999')).status, 404);
  assert.deepEqual(calls, []);
  assert.equal((await request('DELETE', '/1')).status, 200);
  assert.ok(rows.get(1).unavailable_at); assert.deepEqual(calls, [['soft',1,7], ['feed',1]]);
  assert.equal((await request('DELETE', '/2?permanent=1')).status, 200);
  assert.ok(rows.get(2).unavailable_at, 'ordinary owner cannot force permanent deletion');
 });
});
test('delete protects challenge entries, organizer media and in-progress jobs; timed-out jobs can be deleted', async () => {
 await fixture(async ({ request, rows, calls }) => {
  rows.get(1).meta = { challenge_submissions: [{ challenge_id: 1 }] };
  const challenge = await request('DELETE', '/1'); assert.equal(challenge.status, 400); assert.match(challenge.data.error, /challenge/i);
  rows.get(2).status = 'processing'; assert.equal((await request('DELETE', '/2')).status, 400);
  assert.deepEqual(calls, []);
  rows.get(2).meta.timeout_at = '2020-01-01T00:00:00Z'; assert.equal((await request('DELETE', '/2')).status, 200);
 });
});
test('admin permanent delete removes storage, feed, likes, comments and owned row', async () => {
 await fixture(async ({ request, rows, calls }) => {
  rows.get(1).meta = { landscapeFilename: 'landscape.png' };
  assert.equal((await request('DELETE', '/1?permanent=1', null, 99)).status, 200);
  assert.equal(rows.has(1), false);
  assert.deepEqual(calls, [['storage','1.png'], ['storage','landscape.png'], ['feed',1], ['likes',1], ['comments',1], ['permanent',1,7]]);
 });
});
test('group endpoint creates a cover and source snapshots, archives sources, and adds to an existing group', async () => {
 await fixture(async ({ request, rows }) => {
  let res = await request('POST', '/group', { ids: [1,2] }); assert.equal(res.status, 200);
  assert.equal(res.data.mode, 'create_group'); assert.deepEqual(res.data.source_creation_ids, [1,2]);
  const group = rows.get(10);
  assert.equal(group.meta.group.cover_source_id, 1); assert.equal(group.file_path, '/api/images/created/1.png');
  assert.equal(group.created_at, rows.get(1).created_at); assert.equal(group.width, 800);
  assert.ok(rows.get(1).unavailable_at); assert.ok(rows.get(2).unavailable_at);
  res = await request('POST', '/group', { ids: [10,3] }); assert.equal(res.status, 200);
  assert.equal(res.data.mode, 'add_to_existing_group'); assert.deepEqual(rows.get(10).meta.group.source_creation_ids, [1,2,3]); assert.ok(rows.get(3).unavailable_at);
 });
});
test('group rejects unauthorized, published, deleted, mixed media, challenge and unfinished sources without archiving', async () => {
 await fixture(async ({ request, rows, calls }) => {
  assert.equal((await request('POST', '/group', { ids: [1,2] }, 8)).status, 404);
  const row = rows.get(2), original = structuredClone(row);
  for (const patch of [{ published: true }, { unavailable_at: '2026-01-01' }, { status: 'queued' }, { meta: { media_type: 'video' } }, { meta: { challenge_submissions: [{ challenge_id: 9 }] } }, { meta: { group: { kind: 'group_v2' } } }]) {
   Object.assign(row, original, patch);
   assert.equal((await request('POST', '/group', { ids: [1,2] })).status, 400, JSON.stringify(patch));
  }
  assert.deepEqual(calls, []); assert.equal(rows.size, 3);
 });
});
test('database soft deletion scopes the update to creation and owner, embedding cleanup uses WWW table', async () => {
 const calls = [];
 const client = { from(table) { calls.push(['from',table]); return this; }, update(value) { calls.push(['update',value]); return this; }, eq(...args) { calls.push(['eq',...args]); return this; }, delete() { calls.push(['delete']); return this; }, select() { return Promise.resolve({ data: [{ id: 3 }] }); }, storage: { from() { return {}; } } };
 const store = createCreateStore({ client });
 const queries = store.queries || store;
 assert.equal((await queries.markCreatedImageUnavailable.run(3,7)).changes, 1);
 assert.equal(calls[0][1], 'prsn_created_images'); assert.ok(calls[1][1].unavailable_at);
 assert.deepEqual(calls.slice(2), [['eq','id',3], ['eq','user_id',7]]);
 calls.length = 0; await deleteCreationEmbedding(client, 3);
 assert.equal(calls[0][1], 'prsn_created_embeddings');
});

test('group detail actions persist cover changes, reorder sources, and ungroup restores sources and archives the group', async () => {
 await fixture(async ({ request, rows, calls }) => {
  const made = await request('POST', '/group', { ids: [1,2] }); assert.equal(made.status, 200);
  assert.ok(rows.get(1).unavailable_at); assert.ok(rows.get(2).unavailable_at);
  let res = await request('POST', '/10/group-cover', { source_id: 2 });
  assert.equal(res.status, 200); assert.equal(res.data.grouped_creation.meta.group.cover_source_id, 2);
  assert.deepEqual(res.data.grouped_creation.meta.group.source_creation_ids, [2,1]);
  assert.equal(rows.get(10).file_path, '/api/images/created/2.png');
  assert.equal(rows.get(10).width, 800); assert.equal(rows.get(10).created_at, rows.get(2).created_at);
  res = await request('POST', '/10/group-reorder', { source_id: 1 });
  assert.equal(res.status, 200); assert.equal(res.data.grouped_creation.meta.group.cover_source_id, 1);
  assert.deepEqual(res.data.grouped_creation.meta.group.source_creation_ids, [1,2]);
  assert.equal(rows.get(10).file_path, '/api/images/created/1.png');
  res = await request('POST', '/10/ungroup');
  assert.equal(res.status, 200); assert.deepEqual(res.data.restored_creation_ids, [1,2]);
  assert.equal(rows.get(1).unavailable_at, null); assert.equal(rows.get(2).unavailable_at, null);
  assert.ok(rows.get(10).unavailable_at);
  assert.deepEqual(calls.filter(call => ['restore','soft'].includes(call[0])).slice(-3), [['restore',1,7], ['restore',2,7], ['soft',10,7]]);
 });
});

test('group detail mutation routes validate ownership, membership, publication and group type', async () => {
 await fixture(async ({ request, rows, calls }) => {
  await request('POST', '/group', { ids: [1,2] });
  assert.equal((await request('POST', '/10/group-cover', { source_id: 3 }, 8)).status, 404);
  assert.equal((await request('POST', '/10/group-cover', { source_id: 3 })).status, 400);
  rows.get(10).published = true;
  assert.equal((await request('POST', '/10/group-reorder', { source_id: 2 })).status, 400);
  assert.equal((await request('POST', '/10/ungroup')).status, 400);
  assert.equal(rows.get(1).unavailable_at != null, true);
  assert.equal(rows.get(2).unavailable_at != null, true);
 });
});

test('edit save updates the owner creation and a published feed title', async () => {
 await fixture(async ({ request, rows, calls }) => {
  assert.equal((await request('PUT', '/1', { title: 'Night' }, 0)).status, 401);
  assert.equal((await request('PUT', '/1', { title: 'Night' }, 8)).status, 403);
  assert.equal((await request('PUT', '/999', { title: 'Night' })).status, 404);
  rows.get(1).published = true;
  const saved = await request('PUT', '/1', { title: '  Night drive  ', description: 'After dark', nsfw: true, doom_scroll_full_height: true });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.title, 'Night drive');
  assert.equal(saved.data.description, 'After dark');
  assert.equal(saved.data.nsfw, true);
  assert.equal(saved.data.meta.doom_scroll_full_height, true);
  assert.equal(rows.get(1).title, 'Night drive');
  assert.deepEqual(calls.filter(call => call[0] === 'update'), [['update', 1, 'Night drive', 'After dark']]);
  assert.deepEqual(calls.filter(call => call[0] === 'feed-title'), [['feed-title', 1, 'Night drive', 'After dark']]);
  const cleared = await request('PUT', '/2', { title: '   ', description: '' });
  assert.equal(cleared.status, 200);
  assert.equal(rows.get(2).title, null);
  assert.equal(rows.get(2).description, null);
  assert.equal((await request('PUT', '/1', { title: 'Admin edit' }, 99)).status, 200);
  assert.equal(rows.get(1).title, 'Admin edit');
 });
});
