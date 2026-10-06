import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreateDraftStore } from '../client/providers/create/draft.js';
import { createCreationWorkflow } from '../client/providers/create/workflow.js';
import { projectCreateMode } from '../client/providers/create/model.js';
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function setup(overrides = {}) {
 const draft = createCreateDraftStore();
 draft.update({ mode: 'advanced', serverId: 1, methodKey: 'replicate', fieldValues: { prompt: 'hello', model: 'multi', seed: 17, strength: 0.4 }, imageChange: { type: 'replace', images: ['/a.png', '/b.png', '/c.png'] } });
 const sent = [];
 const workflow = createCreationWorkflow({ draft, request: async () => new Response('{}'), send: async payload => { sent.push(payload); return { id: 91 }; }, upload: async file => '/upload-' + file.name, ...overrides });
 return { draft, workflow, sent };
}
test('all modes project one draft and preserve hidden values through route changes', () => {
 const { workflow, draft } = setup();
 for (const mode of ['basic', 'image-edit', 'mutate', 'image-to-video', 'advanced']) workflow.enterMode({ mode });
 assert.deepEqual(draft.read().inputImages, ['/a.png', '/b.png', '/c.png']);
 assert.equal(draft.read().fieldValues.strength, 0.4);
 assert.equal(draft.read().fieldValues.seed, 17);
});
test('Basic submits its first image, preserving the retained list and clearing only submitted prompt', async () => {
 const { workflow, draft, sent } = setup(); workflow.enterMode({ mode: 'image-edit' });
 await workflow.submit({ mode: 'image-edit' });
 assert.deepEqual(sent[0].args, { prompt: 'hello', model: 'xai/grok-imagine-image', image_url: '/a.png' });
 assert.deepEqual(draft.read().inputImages, ['/a.png', '/b.png', '/c.png']);
 assert.equal(draft.read().fieldValues.seed, 17); assert.equal(draft.read().fieldValues.prompt, '');
});
test('a file-only Mutate source follows the pasted-image upload path before new-creation submit', async () => {
 let uploadedFile;
 const { workflow, draft, sent } = setup({ upload: async file => {
  uploadedFile = file;
  return 'https://cdn.parascene.com/s/prepared-input.png';
 } });
 workflow.beginCreate();
 const file = new File(['image bytes'], 'my-file.png', { type: 'image/png' });
 await workflow.selectImages(file, { first: true });
 workflow.enterMode({ mode: 'image-edit' });
 workflow.edit({ fieldValues: { prompt: 'Transform this uploaded file' } });
 await workflow.submit({ mode: 'image-edit' });
 assert.equal(uploadedFile, file);
 assert.equal(draft.read().inputImages[0], 'https://cdn.parascene.com/s/prepared-input.png');
 assert.equal(sent[0].args.image_url, 'https://cdn.parascene.com/s/prepared-input.png');
 assert.equal(sent[0].args.prompt, 'Transform this uploaded file');
});
test('Advanced submits schema fields, including false/zero and the full ordered image list', async () => {
 const { workflow, sent } = setup(); workflow.edit({ fieldValues: { flag: false, seed: 0 } });
 await workflow.submit({ mode: 'advanced', fields: { prompt: {}, seed: {}, flag: {}, custom: { type: 'image_url_array' } } });
 assert.deepEqual(sent[0].args, { prompt: 'hello', seed: 0, flag: false, custom: ['/a.png', '/b.png', '/c.png'] });
});
test('both video engines use their own API arguments and only first saved image', async () => {
 for (const engine of ['ltx', 'wan']) {
  const { workflow, sent, draft } = setup(); workflow.enterMode({ mode: 'image-to-video', engine });
  await workflow.submit({ mode: 'image-to-video' }, { confirm: question => { assert.equal(question.kind, 'video'); return true; } });
  assert.equal(sent[0].serverId, engine === 'ltx' ? 6 : 1);
  assert.equal(sent[0].methodKey, engine === 'ltx' ? 'image2video' : 'replicateVideo');
  if (engine === 'ltx') assert.deepEqual(sent[0].args.input_images, ['/a.png']); else assert.equal(sent[0].args.image, '/a.png');
  assert.equal(draft.read().inputImages.length, 3);
 }
});
test('mention validation succeeds once and signals hydration on submission', async () => {
 let validations = 0; const { workflow, sent } = setup({ request: async (path, options) => { validations++; assert.equal(path, '/api/create/validate'); assert.equal(JSON.parse(options.body).args.prompt, '@harrison'); return new Response('{}'); } });
 workflow.edit({ fieldValues: { prompt: '@harrison' } }); await workflow.submit({ mode: 'basic' });
 assert.equal(validations, 1); assert.equal(sent[0].hydrateMentions, true);
});
test('failed mentions request asks controller; declining preserves draft and sends nothing', async () => {
 const { workflow, draft, sent } = setup({ request: async () => new Response('{}', { status: 400 }) });
 workflow.edit({ fieldValues: { prompt: '@missing' } });
 await assert.rejects(workflow.submit({ mode: 'basic' }, { confirm: question => { assert.equal(question.kind, 'mentions'); return false; } }), { name: 'AbortError' });
 assert.equal(sent.length, 0); assert.equal(draft.read().fieldValues.prompt, '@missing'); assert.equal(workflow.getSnapshot().phase, 'idle');
});
test('mention validation network failure can proceed after explicit confirmation', async () => {
 const { workflow, sent } = setup({ request: async () => { throw new Error('offline'); } }); workflow.edit({ fieldValues: { prompt: '@missing' } });
 await workflow.submit({ mode: 'basic' }, { confirm: () => true }); assert.equal(sent[0].hydrateMentions, false);
});
test('video confirmation cancellation cannot fire a paid request', async () => {
 const { workflow, sent } = setup(); workflow.enterMode({ mode: 'image-to-video' });
 await assert.rejects(workflow.submit({ mode: 'image-to-video' }, { confirm: () => false }), { name: 'AbortError' }); assert.equal(sent.length, 0);
});
test('provider requires explicit UI handler when user input is necessary', async () => {
 const { workflow } = setup(); workflow.enterMode({ mode: 'image-to-video' });
 await assert.rejects(workflow.submit({ mode: 'image-to-video' }), /confirmation handler/);
});
test('newer prompt, including change back to same text, survives an old submission', async () => {
 const pending = deferred(); const { workflow, draft } = setup({ send: () => pending.promise });
 const submitted = workflow.submit({ mode: 'basic' }); await new Promise(resolve => setImmediate(resolve));
 workflow.edit({ fieldValues: { prompt: 'new' } }); workflow.edit({ fieldValues: { prompt: 'hello' } });
 pending.resolve({ id: 91 }); await submitted; assert.equal(draft.read().fieldValues.prompt, 'hello');
});
test('failed submission retains every saved value and permits a deliberate retry', async () => {
 let calls = 0; const { workflow, draft } = setup({ send: async () => { if (!calls++) throw new Error('Insufficient credits'); return { id: 91 }; } });
 const before = draft.read(); await assert.rejects(workflow.submit({ mode: 'basic' }), /Insufficient credits/);
 assert.deepEqual(draft.read(), before); assert.equal(workflow.getSnapshot().phase, 'error'); await workflow.submit({ mode: 'basic' }); assert.equal(calls, 2);
});
test('duplicate clicks do not submit twice', async () => {
 const pending = deferred(); let calls = 0; const { workflow } = setup({ send: () => { calls++; return pending.promise; } });
 const first = workflow.submit({ mode: 'basic' }); await assert.rejects(workflow.submit({ mode: 'basic' }), { code: 'submission_busy' });
 await new Promise(resolve => setImmediate(resolve)); pending.resolve({ id: 91 }); await first; assert.equal(calls, 1);
});
test('unmount during validation cancels before submit', async () => {
 const pending = deferred(); const controller = new AbortController(); const { workflow, sent } = setup({ request: () => pending.promise });
 workflow.edit({ fieldValues: { prompt: '@harrison' } }); const submission = workflow.submit({ mode: 'basic' }, { signal: controller.signal });
 await new Promise(resolve => setImmediate(resolve)); controller.abort(); pending.resolve(new Response('{}'));
 await assert.rejects(submission, { name: 'AbortError' }); assert.equal(sent.length, 0);
});
test('unmount while dialog is open releases submission and ignores a late answer', async () => {
 const answer = deferred(); const controller = new AbortController(); const { workflow, sent } = setup(); workflow.enterMode({ mode: 'image-to-video' });
 const result = workflow.submit({ mode: 'image-to-video' }, { signal: controller.signal, confirm: () => answer.promise });
 await new Promise(resolve => setImmediate(resolve)); controller.abort(); await assert.rejects(result, { name: 'AbortError' }); answer.resolve(true); assert.equal(sent.length, 0);
});
test('destroying provider cancels its pending user input', async () => {
 const answer = deferred(); const { workflow, sent } = setup(); workflow.enterMode({ mode: 'image-to-video' });
 const result = workflow.submit({ mode: 'image-to-video' }, { confirm: () => answer.promise }); await new Promise(resolve => setImmediate(resolve)); workflow.destroy();
 await assert.rejects(result, { name: 'AbortError' }); answer.resolve(true); assert.equal(sent.length, 0);
});
test('latest image selection wins when uploads finish out of order', async () => {
 const old = deferred(); const newer = deferred(); const { workflow, draft } = setup({ upload: file => file.name === 'old' ? old.promise : newer.promise });
 const first = workflow.selectImages(new File(['old'], 'old'), { first: true });
 const second = workflow.selectImages(new File(['new'], 'new'), { first: true });
 newer.resolve('/new.png'); await second; old.resolve('/old.png'); assert.equal(await first, null); assert.deepEqual(draft.read().inputImages, ['/new.png', '/b.png', '/c.png']);
});
test('source replacement defeats an older upload even if replacement has same URL', async () => {
 const upload = deferred(); const { workflow, draft } = setup({ upload: () => upload.promise });
 const result = workflow.selectImages(new File(['old'], 'old'), { first: true });
 draft.update({ imageChange: { type: 'replace', images: ['/a.png', '/b.png', '/c.png'] } }); upload.resolve('/old.png');
 assert.equal(await result, null); assert.equal(draft.read().inputImages[0], '/a.png');
});
test('upload is deduplicated for the same File used in selection and submission', async () => {
 let uploads = 0; const { workflow } = setup({ upload: async () => { uploads++; return '/uploaded.png'; } });
 const file = new File(['x'], 'x'); await workflow.selectImages(file, { first: true });
 await workflow.submit({ mode: 'advanced', fields: { image_url: { type: 'image_url' } }, values: { image_url: file } }); assert.equal(uploads, 1);
});
test('unmounted selection cannot update draft', async () => {
 const pending = deferred(); const controller = new AbortController(); const { workflow, draft } = setup({ upload: () => pending.promise });
 const result = workflow.selectImages(new File(['x'], 'x'), { first: true, signal: controller.signal }); controller.abort(); pending.resolve('/x.png');
 assert.equal(await result, null); assert.equal(draft.read().inputImages[0], '/a.png');
});
test('schema changes choose a supported model without discarding images or hidden fields', () => {
 const { draft } = setup(); const projected = projectCreateMode(draft.read(), { mode: 'advanced', fields: { model: { type: 'select', default: 'new-model', options: ['new-model'] }, images: { type: 'image_url_array' } } });
 assert.equal(projected.model, 'new-model'); assert.deepEqual(projected.images, draft.read().inputImages); assert.equal(draft.read().fieldValues.model, 'multi');
});
test('storage write failure cannot re-read and restore an older persisted draft', () => {
 let raw; let fail = false; const storage = { getItem: () => raw, setItem(key, value) { if (fail) throw new Error('quota'); raw = value; } };
 const draft = createCreateDraftStore({ storage }); draft.update({ fieldValues: { prompt: 'old' } }); fail = true; draft.update({ fieldValues: { prompt: 'new' } }); assert.equal(draft.read().fieldValues.prompt, 'new');
});
test('clear publishes reset and snapshots cannot mutate nested options', () => {
 const draft = createCreateDraftStore(); draft.update({ advancedOptions: { flag: { on: true } } }); const snapshot = draft.read(); snapshot.advancedOptions.flag.on = false; assert.equal(draft.read().advancedOptions.flag.on, true);
 let count = 0; draft.subscribe(() => count++); draft.clear(); assert.equal(count, 2); assert.deepEqual(draft.read().inputImages, []);
});
test('mode or image changes during submission preserve the next draft prompt', async () => {
 for (const change of [{ mode: 'image-to-video' }, { imageChange: { type: 'replaceFirst', image: '/new.png' } }]) {
  const pending = deferred(); const { workflow, draft } = setup({ send: () => pending.promise });
  const submitted = workflow.submit({ mode: 'basic' }); await new Promise(resolve => setImmediate(resolve)); workflow.edit(change); pending.resolve({ id: 91 }); await submitted;
  assert.equal(draft.read().fieldValues.prompt, 'hello');
 }
});
test('submission projects selected-option fields and omits fields hidden by show_when', async () => {
 const { workflow, sent } = setup(); workflow.edit({ fieldValues: { kind: 'image', secret: 3, size: 42 } });
 await workflow.submit({ mode: 'advanced', fields: { kind: { type: 'select', options: [{ value: 'image', fields: { size: {} } }] }, secret: { show_when: { field: 'kind', equals: 'video' } } } });
 assert.deepEqual(sent[0].args, { kind: 'image', size: 42 });
});
test('GPU negotiation is requested through controller and preserves its selected bid', async () => {
 let bid; const { workflow } = setup({ send: async options => { bid = await options.confirmOccupancy({ idle: false }, { lane: 'product' }); return { id: 91 }; } });
 await workflow.submit({ mode: 'basic' }, { confirm: question => { assert.equal(question.kind, 'occupancy'); return { maxBid: 4, charge: 4 }; } });
 assert.deepEqual(bid, { maxBid: 4, charge: 4 });
});
test('GPU negotiation cancellation preserves draft', async () => {
 const { workflow, draft } = setup({ send: async options => { await options.confirmOccupancy({ idle: false }, {}); throw new Error('must not send'); } });
 await assert.rejects(workflow.submit({ mode: 'basic' }, { confirm: () => false }), { name: 'AbortError' }); assert.equal(draft.read().fieldValues.prompt, 'hello');
});
test('an editor switch waits for all selected image uploads before projecting first image', async () => {
 const pending = deferred(); const { workflow, draft } = setup({ upload: file => file.name === 'two' ? pending.promise : Promise.resolve('/one-new.png') });
 const selecting = workflow.selectImages([new File(['one'], 'one'), new File(['two'], 'two')]);
 const flushing = workflow.flushImages(); pending.resolve('/two-new.png'); await selecting; await flushing;
 workflow.enterMode({ mode: 'image-edit' }); assert.equal(workflow.project({ mode: 'image-edit' }).image_url, '/one-new.png'); assert.deepEqual(draft.read().inputImages, ['/one-new.png', '/two-new.png']);
});
test('unsupported persisted model projects its default and its option-specific fields', () => {
 const { workflow } = setup(); const fields = { model: { type: 'select', default: 'new', options: [{ value: 'new', fields: { images: { type: 'image_url_array' } } }] } };
 const result = workflow.project({ mode: 'advanced', fields }); assert.equal(result.model, 'new'); assert.deepEqual(result.images, ['/a.png', '/b.png', '/c.png']);
});
test('required fields are validated centrally for composer and editor callers', async () => {
 const { workflow, sent } = setup(); await assert.rejects(workflow.submit({ mode: 'advanced', fields: { required: { required: true, label: 'a value' } } }), /Enter a value/); assert.equal(sent.length, 0);
});
test('import shares submission exclusion and preserves a newer form draft', async () => {
 const pending = deferred(); const { workflow, draft } = setup({ importSend: () => pending.promise, importer() {} });
 const imported = workflow.importMedia({ provider: 'suno', url: 'https://suno.com/song/test' });
 await assert.rejects(workflow.submit({ mode: 'basic' }), { code: 'submission_busy' }); workflow.edit({ fieldValues: { prompt: 'next draft' } }); pending.resolve({ id: 91 }); await imported;
 assert.equal(draft.read().fieldValues.prompt, 'next draft'); assert.equal(draft.read().inputImages.length, 3);
});
test('Data Builder quote and price confirmation happen centrally before sending', async () => {
 const { workflow, sent } = setup({ request: async (url, options) => { assert.equal(url, '/api/create/query'); assert.equal(JSON.parse(options.body).args.prompt, 'hello'); return new Response(JSON.stringify({ supported: true, cost: 3 })); } });
 await workflow.submit({ mode: 'advanced', fields: { prompt: {} }, quote: true }, { confirm: question => { assert.equal(question.kind, 'cost'); assert.match(question.message, /3 credits/); return true; } });
 assert.equal(sent[0].creditCost, 3);
});
test('unsupported Data Builder request cannot be submitted', async () => {
 const { workflow, sent } = setup({ request: async () => new Response(JSON.stringify({ supported: false })) });
 await assert.rejects(workflow.submit({ mode: 'advanced', fields: {}, quote: true }), /does not support/); assert.equal(sent.length, 0);
});
test('Basic style is saved centrally and omitted by modes that do not support it', async () => {
 const { workflow, sent } = setup(); workflow.enterMode({ mode: 'basic', styleKey: 'cinematic' }); await workflow.submit({ mode: 'basic' }); assert.equal(sent[0].styleKey, 'cinematic');
 workflow.enterMode({ mode: 'image-edit', prompt: 'edit' }); await workflow.submit({ mode: 'image-edit' }); assert.equal(sent[1].styleKey, undefined);
});

test('editing context survives editor changes and returns to exact grouped mutate route', () => {
 const { workflow, draft } = setup();
 const href = '/creations/100/mutate?source_id=17';
 workflow.beginEditing({ creationId: 100, href });
 workflow.openSource({ imageUrl: '/source.png', sourceId: 17 });
 assert.equal(workflow.prepareEditorTransition('advanced'), '/create');
 assert.equal(workflow.consumeEditorTransition('/create'), true);
 workflow.enterMode({ mode: 'advanced' });
 assert.equal(workflow.getEditingCreation().sourceId, 17);
 assert.equal(workflow.prepareEditorTransition('basic'), href);
 assert.equal(workflow.consumeEditorTransition(href), true);
 workflow.beginEditing({ creationId: 100, href });
 assert.equal(workflow.getEditingCreation().sourceResolved, true);
 workflow.endEditing();
 assert.equal(workflow.getEditingCreation(), null);
 assert.deepEqual(draft.read().inputImages, ['/source.png']);
});
test('fresh Create clears editing context and images while preserving other form values', () => {
 const { workflow, draft } = setup();
 workflow.beginEditing({ creationId: 17, href: '/creations/17/mutate' });
 workflow.beginCreate();
 assert.equal(workflow.getEditingCreation(), null);
 assert.equal(workflow.prepareEditorTransition('basic'), '/create');
 assert.equal(draft.read().fieldValues.prompt, 'hello');
 assert.equal(draft.read().inputImages.length, 0);
});
test('accepted submission clears editing context but rejected submission retains it', async () => {
 const { workflow } = setup();
 workflow.beginEditing({ creationId: 17, href: '/creations/17/mutate' });
 await workflow.submit({ mode: 'basic' });
 assert.equal(workflow.getEditingCreation(), null);
 const failed = setup({ send: async () => { throw new Error('Failed'); } }).workflow;
 failed.beginEditing({ creationId: 17, href: '/creations/17/mutate' });
 await assert.rejects(failed.submit({ mode: 'basic' }), /Failed/);
 assert.equal(failed.getEditingCreation().creationId, 17);
});
test('old accepted submission cannot clear a newer editing session', async () => {
 const pending = deferred();
 const { workflow } = setup({ send: () => pending.promise });
 workflow.beginEditing({ creationId: 17, href: '/creations/17/mutate' });
 const submission = workflow.submit({ mode: 'basic' });
 await new Promise(resolve => setTimeout(resolve, 0));
 workflow.endEditing();
 workflow.beginEditing({ creationId: 18, href: '/creations/18/mutate' });
 pending.resolve({ id: 91 });
 await submission;
 assert.equal(workflow.getEditingCreation().creationId, 18);
});

test('explicit text-to-image clears prior mutation images before Advanced handoff', async () => {
 const { workflow, draft, sent } = setup();
 workflow.openSource({ imageUrl: '/old-mutate.png', sourceId: 17 });
 workflow.selectTextToImage({ prompt: 'new picture' });
 workflow.enterMode({ mode: 'advanced' });
 const fields = { prompt: { type: 'text' }, model: { type: 'text' }, image_url: { type: 'image_url' }, input_images: { type: 'image_url_array' } };
 assert.equal(workflow.project({ mode: 'advanced', fields }).image_url, '');
 assert.deepEqual(workflow.project({ mode: 'advanced', fields }).input_images, []);
 await workflow.submit({ mode: 'advanced', fields });
 assert.equal(sent[0].args.image_url, '');
 assert.deepEqual(sent[0].args.input_images, []);
 assert.equal(sent[0].mutateOfId, undefined);
 assert.deepEqual(draft.read().inputImages, []);
 workflow.enterMode({ mode: 'image-edit' });
 workflow.enterMode({ mode: 'advanced' });
 assert.equal(workflow.project({ mode: 'advanced', fields }).image_url, '');
});
test('explicit Advanced image selection enables inputs after text-to-image handoff', async () => {
 const { workflow } = setup();
 workflow.enterMode({ mode: 'basic' });
 workflow.enterMode({ mode: 'advanced' });
 await workflow.selectImages('/new.png');
 assert.equal(workflow.project({ mode: 'advanced', fields: { image_url: { type: 'image_url' } } }).image_url, '/new.png');
});

 test('editor switches preserve all images; closing retains the draft; Mutate replaces inputs', () => {
  const { workflow, draft } = setup();
  workflow.enterMode({ mode: 'basic' });
  workflow.enterMode({ mode: 'advanced' });
  assert.deepEqual(workflow.project({ mode: 'advanced', fields: { images: { type: 'image_url_array' } } }).images, ['/a.png', '/b.png', '/c.png']);
  workflow.endEditing();
  assert.equal(draft.read().inputImages.length, 3);
  workflow.openSource({ imageUrl: '/replacement.png', sourceId: 19 });
  assert.deepEqual(draft.read().inputImages, ['/replacement.png']);
 });

test('Recreate handoff preserves restored recipe inputs while clearing old edit context', () => {
 const { workflow, draft } = setup({ restoreRecipe: recipe => { draft.update({ imageChange: { type: 'replace', images: recipe.images }, fieldValues: { prompt: recipe.prompt } }); return { serverId: 1, methodKey: 'replicate' }; } });
 workflow.beginEditing({ creationId: 17, href: '/creations/17/mutate' });
 assert.equal(workflow.recreate({ images: ['/recipe-input.png'], prompt: 'recipe' }).href, '/create');
 assert.equal(workflow.getEditingCreation(), null);
 assert.equal(workflow.consumeEditorTransition('/create'), true);
 workflow.enterMode({ mode: 'advanced' });
 assert.equal(workflow.project({ mode: 'advanced', fields: { image_url: { type: 'image_url' } } }).image_url, '/recipe-input.png');
 assert.deepEqual(draft.read().inputImages, ['/recipe-input.png']);
 workflow.beginCreate();
 assert.deepEqual(draft.read().inputImages, []);
});

test('restored recipe ancestry is submitted only for its unchanged input set', async () => {
 const { workflow, sent } = setup();
 workflow.edit({ imageChange: { type: 'replace', images: ['/source.png'] }, imageSources: {}, recipeLineage: { images: ['/source.png'], parentIds: [17, 18] } });
 workflow.enterMode({ mode: 'image-edit', prompt: 'recreate' });
 await workflow.submit({ mode: 'image-edit' });
 assert.deepEqual(sent[0].mutateParentIds, [17, 18]);
 assert.equal(sent[0].mutateOfId, undefined);
 await workflow.selectImages('/different.png');
 workflow.enterMode({ mode: 'image-edit', prompt: 'different input' });
 await workflow.submit({ mode: 'image-edit' });
 assert.equal(sent[1].mutateParentIds, undefined);
});
