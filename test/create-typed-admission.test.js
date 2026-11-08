import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import createCreateRoutes from '../server/routes/create.js';
import { inputFromLegacyImage } from '../shared/creationInputs.js';

test('typed grouped source is admitted independently of output destination', async () => {
 const rows = new Map([
  [50, { id: 50, user_id: 8, published: 1, status: 'completed', meta: { group: { kind: 'group_creations', source_creation_ids: [92], source_creations: [{ id: 92, filename: 'blue.png', file_path: '/api/images/created/blue.png', status: 'completed' }] } } }],
  [92, { id: 92, user_id: 8, published: 0, status: 'completed', filename: 'blue.png', unavailable_at: '2026-11-08T12:00:00Z', meta: {} }],
  [70, { id: 70, user_id: 7, published: 0, status: 'completed', meta: { group: { kind: 'group_v2', items: [] } } }],
 ]);
 let balance = 10;
 let inserted;
 let queued;
 let groupWrites = 0;
 const queries = {
  selectUserById: { get: async () => ({ id: 7, role: 'user' }) },
  selectUserProfileByUserId: { get: async () => null },
  selectServerById: { get: async () => ({ id: 1, name: 'Test', server_url: 'https://provider.example', status: 'active', server_config: { methods: { edit: { name: 'Edit', credits: 1, fields: { image_url: { type: 'image_url' }, prompt: { type: 'textarea' } } } } } }) },
  selectUserCredits: { get: async () => ({ balance }) },
  updateUserCreditsBalance: { run: async (_id, delta) => { balance += delta; } },
  selectCreatedImageByIdAnyUser: { get: async id => rows.get(Number(id)) || null },
  selectCreatedImageById: { get: async (id, userId) => Number(userId) === 7 && Number(id) === 70 ? rows.get(70) : null },
  insertCreatedImage: { run: async (...values) => { inserted = values; return { insertId: 101 }; } },
  updateCreatedImageMeta: { run: async () => { groupWrites++; return { changes: 1 }; } },
 };
 const app = express();
 app.use(express.json());
 app.use((req, _res, next) => { req.auth = { userId: 7 }; next(); });
 app.use(createCreateRoutes({ queries, storage: { getImageUrl: filename => `/api/images/created/${filename}` }, canUseServer: async () => true }));
 app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
 const server = await new Promise(done => { const listener = app.listen(0, '127.0.0.1', () => done(listener)); });
 const previous = { mode: process.env.CREATION_JOB_MODE, token: process.env.UPSTASH_QSTASH_TOKEN, url: process.env.UPSTASH_QSTASH_URL, fetch: globalThis.fetch };
 process.env.CREATION_JOB_MODE = 'qstash';
 process.env.UPSTASH_QSTASH_TOKEN = 'test-only-token';
 process.env.UPSTASH_QSTASH_URL = 'https://queue.example';
 globalThis.fetch = async (url, options) => String(url).startsWith('https://queue.example/')
  ? (queued = JSON.parse(options.body), new Response('{}', { status: 200 })) : previous.fetch(url, options);
 try {
  const input = inputFromLegacyImage('/wrong-cover.png', { sourceId: 92, groupId: 50 }, 'selected');
  const base = `http://127.0.0.1:${server.address().port}/api/create`;
  const sourceResponse = await previous.fetch(`${base}/images/50/mutate-source?source_id=92`);
  assert.equal(sourceResponse.status, 200, JSON.stringify(await sourceResponse.clone().json()));
  const sourcePayload = await sourceResponse.json();
  assert.equal(sourcePayload.id, 92);
  assert.equal(sourcePayload.group_id, 50);
  const body = { server_id: 1, method: 'edit', args: { prompt: 'edit', image_url: '/wrong-cover.png' }, creation_token: 'creation-token-123',
   input_contract_version: 1, inputs: [input], input_bindings: [{ field: 'image_url', attachmentIds: ['selected'] }] };
  const post = value => previous.fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const response = await post(body);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(balance, 9);
  assert.equal(groupWrites, 0);
  assert.equal(inserted[7].direct_parent_ids[0], 92);
  assert.equal(inserted[7].input_recipe.inputs[0].source.groupId, 50);
  assert.match(queued.args.image_url, /\/api\/share\/v1\/.*\/image$/);
  assert.equal(queued.args.image_url.includes('wrong-cover'), false);

  const denied = await post({ ...body, creation_token: 'creation-token-456', inputs: [inputFromLegacyImage('/wrong-cover.png', { sourceId: 92, groupId: 51 }, 'selected')] });
  assert.equal(denied.status, 404);
  assert.equal(balance, 9);
  const mismatched = await post({ ...body, creation_token: 'creation-token-mismatch', args: { prompt: 'edit', image_url: '/different.png' } });
  assert.equal(mismatched.status, 400);
  assert.equal(balance, 9);
  const foreignDestination = await post({ ...body, creation_token: 'creation-token-789', destination_group_id: 50 });
  assert.equal(foreignDestination.status, 404);
  assert.equal(balance, 9);
  const ownedDestination = await post({ ...body, creation_token: 'creation-token-987', destination_group_id: 70 });
  assert.equal(ownedDestination.status, 200, JSON.stringify(await ownedDestination.clone().json()));
  assert.equal(groupWrites, 1);
  assert.equal(balance, 8);
 } finally {
  globalThis.fetch = previous.fetch;
  for (const [name, value] of [['CREATION_JOB_MODE', previous.mode], ['UPSTASH_QSTASH_TOKEN', previous.token], ['UPSTASH_QSTASH_URL', previous.url]]) {
   if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await new Promise(done => server.close(done));
 }
});
