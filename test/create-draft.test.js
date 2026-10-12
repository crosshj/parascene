import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCreateDraftChange as change, normalizeCreateDraft, projectCreateDraft, createCreateDraftStore } from '../client/providers/create/draft.js';
const original = () => change({}, { serverId: 6, methodKey: 'advancedEdit', fieldValues: { prompt: 'original', model: 'multi', strength: 0.7, seed: 42 }, imageChange: { type: 'replace', images: ['/a.png', '/b.png', '/c.png'] } });
test('Advanced → Basic → Advanced retains all images and hidden values', () => {
 const basic = change(original(), { serverId: 1, methodKey: 'replicate', fieldValues: { model: 'single', prompt: 'basic edit', input_images: ['/a.png'], image_url: '/a.png' } });
 assert.deepEqual(basic.inputImages, ['/a.png', '/b.png', '/c.png']);
 assert.equal(basic.fieldValues.strength, 0.7);
 assert.equal(basic.fieldValues.seed, 42);
 assert.equal(basic.serverId, 1);
 assert.equal(basic.fieldValues.prompt, 'basic edit');
 assert.deepEqual(projectCreateDraft(basic, { image: { type: 'image_url' } }), { image: '/a.png' });
 assert.deepEqual(projectCreateDraft(basic, { input_images: { type: 'image_url_array' } }), { input_images: ['/a.png', '/b.png', '/c.png'] });
});
test('Replacing only the first image retains the tail', () => {
 const draft = change(original(), { imageChange: { type: 'replaceFirst', image: '/new.png' } });
 assert.deepEqual(draft.inputImages, ['/new.png', '/b.png', '/c.png']);
 assert.equal(draft.fieldValues.image_url, '/new.png');
});
test('Removing an image and clearing all images are distinct explicit operations', () => {
 const draft = change(original(), { imageChange: { type: 'removeFirst' } });
 assert.deepEqual(draft.inputImages, ['/b.png', '/c.png']);
 assert.deepEqual(change(draft, { imageChange: { type: 'clear' } }).inputImages, []);
});
test('Entering Mutate replaces the saved source list explicitly', () => {
 assert.deepEqual(change(original(), { imageChange: { type: 'replace', images: ['/mutate.png'] } }).fieldValues.input_images, ['/mutate.png']);
});
test('Empty prompt, false and zero edits persist', () => {
 const draft = change(original(), { fieldValues: { prompt: '', strength: 0, enabled: false } });
 assert.equal(draft.fieldValues.prompt, ''); assert.equal(draft.fieldValues.strength, 0);
 assert.equal(draft.fieldValues.enabled, false); assert.equal(draft.fieldValues.seed, 42);
});
test('Changing video mode and engine retains attachments', () => {
 const draft = change(original(), { methodKey: 'ltxVideo', outputMode: 'video', fieldValues: { model: 'ltx' } });
 assert.deepEqual(draft.inputImages, original().inputImages); assert.equal(draft.outputMode, 'video');
});
test('Submission projection excludes unsupported values without modifying the draft', () => {
 const draft = original(); const before = JSON.stringify(draft);
 const values = projectCreateDraft(draft, { prompt: { type: 'textarea' }, image: { type: 'image_url' } });
 assert.deepEqual(values, { prompt: 'original', image: '/a.png' });
 values.image = '/different.png'; assert.equal(JSON.stringify(draft), before);
});
test('Legacy image arrays migrate and survive reload', () => {
 const memory = new Map([['create-page-selections', JSON.stringify({ fieldValues: { input_images: ['/a.png', '/b.png'], prompt: 'old' } })]]);
 const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
 createCreateDraftStore({ storage }).update({ fieldValues: { prompt: 'new', image_url: '/a.png' } });
 const draft = createCreateDraftStore({ storage }).read();
 assert.deepEqual(draft.inputImages, ['/a.png', '/b.png']); assert.equal(draft.fieldValues.prompt, 'new');
});
test('Unknown operations fail without mutating the input', () => {
 const draft = original(); const before = JSON.stringify(draft);
 assert.throws(() => change(draft, { imageChange: { type: 'guess' } }), /Unknown image/);
 assert.equal(JSON.stringify(draft), before);
});
test('Files, objects and omitted fields do not erase saved values', () => {
 const draft = change(original(), { fieldValues: { prompt: undefined, image_url: {}, opaque: {} } });
 assert.equal(draft.fieldValues.prompt, 'original'); assert.equal(draft.fieldValues.image_url, '/a.png');
 assert.equal(draft.fieldValues.opaque, undefined);
});
test('Unavailable storage retains an in-memory draft', () => {
 const store = createCreateDraftStore({ storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } } });
 store.update({ fieldValues: { prompt: 'kept' }, imageChange: { type: 'replace', images: ['/a.png'] } });
 assert.equal(store.read().fieldValues.prompt, 'kept'); assert.deepEqual(store.read().inputImages, ['/a.png']);
 assert.deepEqual(normalizeCreateDraft(null).inputImages, []);
});

test('Explicit removal of another field preserves everything else', () => {
 const draft = change(original(), { clearFields: ['strength'] });
 assert.equal(draft.fieldValues.strength, undefined);
 assert.equal(draft.fieldValues.seed, 42);
 assert.deepEqual(draft.inputImages, original().inputImages);
 assert.throws(() => change(draft, { clearFields: ['input_images'] }), /explicit image action/);
});
test('Subscriber snapshots cannot modify the saved attachment or field arrays', () => {
 const store = createCreateDraftStore();
 store.update({ fieldValues: { tags: ['one', 'two'] }, imageChange: { type: 'replace', images: ['/one.png', '/two.png'] } });
 const unsubscribe = store.subscribe(snapshot => {
  snapshot.inputImages.pop(); snapshot.fieldValues.tags.pop();
 });
 assert.deepEqual(store.read().inputImages, ['/one.png', '/two.png']);
 assert.deepEqual(store.read().fieldValues.tags, ['one', 'two']);
 unsubscribe();
});
test('Repeated editor changes and reloads never truncate an untouched image list', () => {
 const memory = new Map();
 const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
 let store = createCreateDraftStore({ storage });
 store.update({ imageChange: { type: 'replace', images: ['/one.png', '/two.png', '/three.png'] }, fieldValues: { hiddenSetting: 9 } });
 for (let i = 0; i < 50; i++) {
  store.update({ serverId: i % 2 ? 6 : 1, methodKey: i % 3 ? 'replicate' : 'video', fieldValues: { prompt: `edit ${i}`, image_url: '/one.png', input_images: ['/one.png'] } });
  store = createCreateDraftStore({ storage });
  assert.deepEqual(store.read().inputImages, ['/one.png', '/two.png', '/three.png']);
  assert.equal(store.read().fieldValues.hiddenSetting, 9);
 }
});
