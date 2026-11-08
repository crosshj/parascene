import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCreateDraftChange } from '../client/providers/create/draft.js';
import { bindingsForImageArgs, inputFromLegacyImage, materializeInputBindings, normalizeCreationInput } from '../shared/creationInputs.js';
import { resolveCreationInputs } from '../server/services/create/resolveCreationInputs.js';
import { addToMutateQueue, loadMutateQueue, replaceMutateQueueFromImageUrls } from '../client/shared/mutateQueue.js';
import express from 'express';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import createShareRoutes from '../server/routes/share.js';
import { ACTIVE_SHARE_VERSION, mintShareToken } from '../server/routes/utils/shareLink.js';
import { materializeArchivedGroupInput } from '../server/services/create/materializeArchivedGroupInput.js';

const group = (id, member, url = '/same.png') => inputFromLegacyImage(url, { sourceId: member, groupId: id }, `member-${id}-${member}`);
const fields = { input_images: { type: 'image_url_array' } };
const user = { id: 7, role: 'user' };
function fixture() {
 const rows = new Map([
  [50, { id: 50, user_id: 8, published: 1, status: 'completed', meta: { group: { kind: 'group_creations', source_creation_ids: [91, 92] } } }],
  [60, { id: 60, user_id: 7, published: 0, status: 'completed', meta: { group: { kind: 'group_creations', source_creation_ids: [93] } } }],
  [91, { id: 91, user_id: 8, published: 0, status: 'completed', filename: 'red.png' }],
  [92, { id: 92, user_id: 8, published: 0, status: 'completed', filename: 'blue.png' }],
  [93, { id: 93, user_id: 7, published: 0, status: 'completed', filename: 'green.png' }],
 ]);
 return { rows, queries: { selectCreatedImageByIdAnyUser: { get: async id => rows.get(Number(id)) } } };
}
const resolve = (inputs, bindings, fixtureData = fixture()) => resolveCreationInputs({
 inputs, bindings, fields, args: { input_images: inputs.map(input => input.preview.url), prompt: 'edit' },
 queries: fixtureData.queries, user, providerBase: 'https://app.example', shareUrlForImage: id => `https://app.example/fetch/${id}`,
 resolveInternalUrl: async () => null,
});

test('selected non-cover member and mixed groups resolve to ordered exact provider inputs', async () => {
 const inputs = [group(50, 92), group(60, 93)];
 const result = await resolve(inputs, [{ field: 'input_images', attachmentIds: inputs.map(input => input.id) }]);
 assert.deepEqual(result.args.input_images, ['https://app.example/fetch/92', 'https://app.example/fetch/93']);
 assert.deepEqual(result.directParentIds, [92, 93]);
 assert.deepEqual(result.recipe.inputs.map(input => input.source.groupId), [50, 60]);
});

test('a wrong group or unavailable member fails before a provider argument is produced', async () => {
 const inputs = [group(60, 92)];
 await assert.rejects(resolve(inputs, [{ field: 'input_images', attachmentIds: [inputs[0].id] }]), { code: 'member_not_in_group' });
 const data = fixture(); data.rows.delete(92);
 await assert.rejects(resolve([group(50, 92)], [{ field: 'input_images', attachmentIds: ['member-50-92'] }], data), { code: 'source_unavailable' });
});

test('archived group snapshot is materialized from its recorded artifact', async () => {
 const data = fixture();
 data.rows.delete(92);
 data.rows.get(50).meta.group.source_creations = [{ id: 92, filename: 'blue.png', status: 'completed' }];
 const input = group(50, 92, '/stale-cover.png');
 const requested = [];
 const result = await resolveCreationInputs({ inputs: [input], bindings: [{ field: 'input_images', attachmentIds: [input.id] }], fields,
  args: { input_images: ['/stale-cover.png'] }, queries: data.queries, user, providerBase: 'https://app.example',
  shareUrlForImage: id => `https://app.example/fetch/${id}`,
  materializeArchived: async value => { requested.push(value); return 'https://cdn.example/edited/blue.png'; } });
 assert.deepEqual(requested, [{ groupId: 50, creationId: 92, filename: 'blue.png' }]);
 assert.deepEqual(result.args.input_images, ['https://cdn.example/edited/blue.png']);
 assert.deepEqual(result.directParentIds, [92]);
});

test('native v2 member uses an authorized live row path and rejects a missing row', async () => {
 const data = fixture();
 data.rows.get(92).filename = null;
 data.rows.get(92).file_path = '/api/images/created/blue.png';
 data.rows.get(50).meta = { group: { kind: 'group_v2', items: [
  { pointer: { kind: 'creation', creationId: 91 }, view: { filename: 'red.png', status: 'completed' } },
  { pointer: { kind: 'creation', creationId: 92 }, view: { filePath: '/api/images/created/blue.png', status: 'completed', mediaType: 'image' } },
 ] } };
 const input = group(50, 92, '/preview-of-blue.png');
 const requested = [];
 const result = await resolveCreationInputs({ inputs: [input], bindings: [{ field: 'input_images', attachmentIds: [input.id] }], fields,
  args: { input_images: [input.preview.url] }, queries: data.queries, user, providerBase: 'https://app.example',
  shareUrlForImage: id => `https://app.example/fetch/${id}`,
  materializeArchived: async value => { requested.push(value); return 'https://cdn.example/edited/blue.png'; } });
 assert.deepEqual(requested, [{ groupId: 50, creationId: 92, filename: 'blue.png' }]);
 assert.deepEqual(result.args.input_images, ['https://cdn.example/edited/blue.png']);
 assert.deepEqual(result.directParentIds, [92]);
 data.rows.delete(92);
 await assert.rejects(resolveCreationInputs({ inputs: [input], bindings: [{ field: 'input_images', attachmentIds: [input.id] }], fields,
  args: { input_images: [input.preview.url] }, queries: data.queries, user, providerBase: 'https://app.example',
  materializeArchived: async () => 'https://cdn.example/edited/blue.png' }), { code: 'source_unavailable' });
});

test('group member with a live row but no filename uses its saved member artifact', async () => {
 const data = fixture();
 data.rows.get(92).filename = null;
 data.rows.get(50).meta.group.source_creations = [{ id: 92, filename: 'blue.png', status: 'completed' }];
 const input = group(50, 92);
 const requested = [];
 const result = await resolveCreationInputs({ inputs: [input], bindings: [{ field: 'input_images', attachmentIds: [input.id] }], fields,
  args: { input_images: [input.preview.url] }, queries: data.queries, user, providerBase: 'https://app.example',
  shareUrlForImage: id => `https://app.example/fetch/${id}`,
  materializeArchived: async value => { requested.push(value); return 'https://cdn.example/edited/blue.png'; } });
 assert.deepEqual(requested, [{ groupId: 50, creationId: 92, filename: 'blue.png' }]);
 assert.deepEqual(result.args.input_images, ['https://cdn.example/edited/blue.png']);
 data.rows.get(92).unavailable_at = '2026-11-08';
 await assert.rejects(resolveCreationInputs({ inputs: [input], bindings: [{ field: 'input_images', attachmentIds: [input.id] }], fields,
  args: { input_images: [input.preview.url] }, queries: data.queries, user, providerBase: 'https://app.example',
  materializeArchived: async () => 'https://cdn.example/edited/blue.png' }), { code: 'source_unavailable' });
});

test('archived source materialization publishes the selected snapshot pixels for provider fetch', async () => {
 const blue = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#0000ff' } }).png().toBuffer();
 let uploaded;
 const url = await materializeArchivedGroupInput({ userId: 7, filename: 'blue.png', storage: {
  getImageBuffer: async filename => { assert.equal(filename, 'blue.png'); return blue; },
  uploadGenericImage: async (bytes, key, options) => { uploaded = { bytes, key, options }; },
 } });
 assert.match(url, /^https:\/\/cdn\.parascene\.com\/api\/images\/generic\/edited\/7\//);
 assert.equal(uploaded.options.contentType, 'image/png');
 assert.deepEqual(await sharp(uploaded.bytes).raw().toBuffer(), await sharp(blue).raw().toBuffer());
});

test('duplicate display URLs retain distinct attachment identities in the draft', () => {
 const inputs = [group(50, 91), group(50, 92)];
 const draft = applyCreateDraftChange({}, { imageChange: { type: 'setInputs', inputs } });
 assert.deepEqual(draft.inputs.map(input => input.source.member.creationId), [91, 92]);
 const bindings = bindingsForImageArgs(draft.inputs, { input_images: ['/same.png', '/same.png'] }, fields);
 assert.deepEqual(bindings[0].attachmentIds, inputs.map(input => input.id));
});
test('replacing a recipe input removes only that input provenance', () => {
 const inputs = [group(50, 91, '/a.png'), group(60, 93, '/b.png')];
 const original = applyCreateDraftChange({}, { imageChange: { type: 'setInputs', inputs } });
 const changed = applyCreateDraftChange(original, { imageChange: { type: 'replace', images: ['/a.png', '/new.png'] } });
 assert.equal(changed.inputs[0].source.groupId, 50);
 assert.equal(changed.inputs[1].source.kind, 'external-image');
 assert.equal(changed.inputs.some(input => input.source.groupId === 60), false);
});

test('separate scalar provider fields bind their own selected member', async () => {
 const inputs = [group(50, 91), group(50, 92)];
 const bound = materializeInputBindings(inputs, { first_image: '/same.png', second_image: '/same.png' },
  { first_image: { type: 'image_url' }, second_image: { type: 'image_url' } });
 assert.deepEqual(bound.bindings.map(binding => binding.attachmentIds[0]), inputs.map(input => input.id));
 const result = await resolveCreationInputs({ ...bound, fields: { first_image: { type: 'image_url' }, second_image: { type: 'image_url' } },
  args: { first_image: '/same.png', second_image: '/same.png' }, queries: fixture().queries, user,
  providerBase: 'https://app.example', shareUrlForImage: id => `https://app.example/fetch/${id}` });
 assert.deepEqual([result.args.first_image, result.args.second_image], ['https://app.example/fetch/91', 'https://app.example/fetch/92']);
});

test('a published group grants member access but project remix limits are honored', async () => {
 const input = group(50, 91);
 const data = fixture();
 data.rows.get(50).meta = { type: 'project', group: { kind: 'group_v2', items: [{ pointer: { kind: 'creation', creationId: 91 } }] } };
 await assert.rejects(resolve([input], [{ field: 'input_images', attachmentIds: [input.id] }], data), { code: 'source_kind_unsupported' });
});

test('v2 creation pointers resolve and local pointers require an explicit adapter', async () => {
 const data = fixture();
 data.rows.get(50).meta = { group: { kind: 'group_v2', items: [{ pointer: { kind: 'creation', creationId: 92 } }] } };
 const input = group(50, 92);
 const result = await resolve([input], [{ field: 'input_images', attachmentIds: [input.id] }], data);
 assert.deepEqual(result.directParentIds, [92]);
 assert.throws(() => normalizeCreationInput({ id: 'local', source: { kind: 'group-member', groupId: 50, member: { kind: 'local', assetId: 1 } }, preview: { url: '/local.png' } }), /Invalid group member/);
});

test('queue retains two members with one display URL and reorders by identity', () => {
 const memory = new Map();
 const previousWindow = globalThis.window;
 globalThis.window = { localStorage: { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) } };
 try {
  addToMutateQueue({ sourceId: 91, groupId: 50, imageUrl: '/same.png' });
  addToMutateQueue({ sourceId: 92, groupId: 50, imageUrl: '/same.png' });
  assert.deepEqual(loadMutateQueue().map(item => item.sourceId), [92, 91]);
  replaceMutateQueueFromImageUrls(['/same.png', '/same.png'], { sourceIds: [91, 92], groupIds: [50, 50] });
  assert.deepEqual(loadMutateQueue().map(item => item.sourceId), [91, 92]);
 } finally { globalThis.window = previousWindow; }
});
test('a queued frame submits its captured artifact and keeps validated video provenance', async () => {
 const frameUrl = 'https://cdn.parascene.com/api/images/generic/edited/7/frame.png';
 const input = inputFromLegacyImage(frameUrl, { sourceId: 93, fromFrame: true, frameTimeSec: 2.5 }, 'frame');
 assert.equal(input.source.kind, 'derived-still');
 const result = await resolveCreationInputs({ inputs: [input], bindings: [{ field: 'image_url', attachmentIds: ['frame'] }],
  fields: { image_url: { type: 'image_url' } }, args: { image_url: frameUrl }, queries: fixture().queries, user,
  providerBase: 'https://sh.parascene.com', shareUrlForImage: id => `https://sh.parascene.com/parent/${id}` });
 assert.equal(result.args.image_url, frameUrl);
 assert.deepEqual(result.directParentIds, [93]);
 assert.equal(result.recipe.inputs[0].source.frameTimeSec, 2.5);
});
test('pasted internal media URL cannot bypass source authorization', async () => {
 const input = inputFromLegacyImage('https://www.parascene.com/api/images/created/blue.png', {}, 'pasted');
 await assert.rejects(resolveCreationInputs({ inputs: [input], bindings: [{ field: 'image_url', attachmentIds: ['pasted'] }],
  fields: { image_url: { type: 'image_url' } }, args: { image_url: input.preview.url }, queries: fixture().queries,
  user, providerBase: 'https://sh.parascene.com' }), { code: 'source_kind_unsupported' });
});
test('relative generic upload becomes a provider-fetchable CDN URL', async () => {
 const input = inputFromLegacyImage('/api/images/generic/edited/7/upload.png', {}, 'upload');
 const result = await resolveCreationInputs({ inputs: [input], bindings: [{ field: 'image_url', attachmentIds: ['upload'] }],
  fields: { image_url: { type: 'image_url' } }, args: { image_url: input.preview.url }, queries: fixture().queries,
  user, providerBase: 'https://sh.parascene.com' });
 assert.equal(result.args.image_url, 'https://cdn.parascene.com/api/images/generic/edited/7/upload.png');
});

test('a provider without a session fetches the selected non-cover member bytes', async () => {
 const data = fixture();
 const pixels = new Map([
  ['red.png', await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer()],
  ['blue.png', await sharp({ create: { width: 2, height: 2, channels: 4, background: '#0000ff' } }).png().toBuffer()],
 ]);
 const app = express();
 app.use(createShareRoutes({ queries: data.queries, storage: { getImageBuffer: async filename => pixels.get(filename) } }));
 const server = await new Promise(done => { const listener = app.listen(0, '127.0.0.1', () => done(listener)); });
 try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const input = group(50, 92, '/cover-or-stale-preview.png');
  const result = await resolveCreationInputs({ inputs: [input], bindings: [{ field: 'input_images', attachmentIds: [input.id] }], fields,
   args: { input_images: ['/cover-or-stale-preview.png'] }, queries: data.queries, user, providerBase: origin,
   shareUrlForImage: id => `${origin}/api/share/${ACTIVE_SHARE_VERSION}/${mintShareToken({ imageId: id, sharedByUserId: user.id })}/image` });
  const response = await fetch(result.args.input_images[0]);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = buffer => createHash('sha256').update(buffer).digest('hex');
  assert.equal(hash(bytes), hash(pixels.get('blue.png')));
  assert.notEqual(hash(bytes), hash(pixels.get('red.png')));
 } finally { await new Promise(done => server.close(done)); }
});
