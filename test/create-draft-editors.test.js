import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { persistSavedCreateForm, readSavedCreateForm, getSavedCreateDraftStore, mergeSharedSettingsIntoSessionSelections } from '../client/shared/createSettingsSync.js';
import { persistMutateForm, syncMutateSourceToCreateStorage, syncMutatePageToAdvancedCreate, syncSavedCreateImagesToQueue, syncCreationDetailToAdvancedCreate, syncMutateQueueFromComposerAttachments } from '../client/shared/mutateQueueSync.js';
import { loadMutateQueue } from '../client/shared/mutateQueue.js';
import { projectCreateDraft } from '../client/providers/create/draft.js';
const dom = new JSDOM('', { url: 'http://localhost/create' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.CustomEvent = dom.window.CustomEvent;
function reset() {
 window.localStorage.clear(); window.sessionStorage.clear(); getSavedCreateDraftStore().clear();
}
const images = ['/a.png', '/b.png', '/c.png'];
function advanced() {
 persistSavedCreateForm({ serverId: 6, methodKey: 'gpu', fieldValues: { prompt: 'hello', model: 'multi', steps: 30 }, imageChange: { type: 'replace', images } });
 syncSavedCreateImagesToQueue();
}
test('real editor adapters preserve multi-image input across Basic and Advanced handoff', () => {
 reset(); advanced();
 persistSavedCreateForm({ serverId: 1, methodKey: 'replicate', outputMode: 'image', fieldValues: { prompt: 'basic edit', model: 'xai/grok-imagine-image', image_url: '/a.png', input_images: ['/a.png'] } });
 syncMutatePageToAdvancedCreate({ mode: 'image-to-image', prompt: 'basic edit', imageUrl: '/a.png', aspectRatio: '16:9' });
 const draft = readSavedCreateForm();
 assert.deepEqual(draft.inputImages, images);
 assert.deepEqual(loadMutateQueue().map(item => item.imageUrl), images);
 assert.equal(draft.fieldValues.steps, 30);
 assert.equal(draft.fieldValues.prompt, 'basic edit');
 assert.equal(draft.serverId, 1);
 assert.deepEqual(projectCreateDraft(draft, { input_images: { type: 'image_url_array' } }).input_images, images);
});
test('entering Mutate replaces images immediately and retains source lineage', () => {
 reset(); advanced();
 syncMutateSourceToCreateStorage({ imageUrl: '/source.png', sourceId: 91, published: true });
 assert.deepEqual(readSavedCreateForm().inputImages, ['/source.png']);
 assert.equal(loadMutateQueue()[0].sourceId, 91);
 assert.equal(loadMutateQueue()[0].published, true);
 const stored = JSON.parse(window.sessionStorage.getItem('create-page-selections'));
 assert.deepEqual(stored.fieldValues.input_images, ['/source.png']);
});
test('Mutate edits and video engine changes update the route without waiting for a switch', () => {
 reset(); syncMutateSourceToCreateStorage({ imageUrl: '/source.png', sourceId: 91 });
 persistMutateForm({ mode: 'image-to-video', i2vEngine: 'ltx', prompt: 'animate', aspectRatio: '9:16', imageUrl: '/source.png' });
 const ltx = readSavedCreateForm();
 assert.equal(ltx.outputMode, 'video'); assert.equal(ltx.fieldValues.prompt, 'animate');
 assert.equal(ltx.fieldValues.aspect_ratio, '9:16');
 persistMutateForm({ mode: 'image-to-video', i2vEngine: 'wan', prompt: '', imageUrl: '/source.png' });
 const wan = readSavedCreateForm();
 assert.notEqual(wan.methodKey, ltx.methodKey); assert.equal(wan.fieldValues.prompt, '');
 assert.deepEqual(wan.inputImages, ['/source.png']);
});
test('stale compatibility settings cannot overwrite a versioned shared draft', () => {
 reset(); advanced();
 window.localStorage.setItem('create_page_prompt', 'stale');
 window.localStorage.setItem('create_page_server_id', '999');
 mergeSharedSettingsIntoSessionSelections();
 assert.equal(readSavedCreateForm().fieldValues.prompt, 'hello');
 assert.equal(readSavedCreateForm().serverId, 6);
});
test('composer attachments use the same draft and preserve supplied lineage', () => {
 reset(); advanced();
 syncMutateQueueFromComposerAttachments(['/new.png', '/second.png'], [17, 18]);
 assert.deepEqual(readSavedCreateForm().inputImages, ['/new.png', '/second.png']);
 assert.deepEqual(loadMutateQueue().map(item => item.sourceId), [17, 18]);
});
test('reusing a creation recipe explicitly replaces input attachments rather than using its output', () => {
 reset(); advanced();
 syncCreationDetailToAdvancedCreate({ serverId: 1, methodKey: 'replicate', args: { model: 'xai/grok-imagine-image', prompt: 'recipe', input_images: ['/recipe.png'] } });
 assert.deepEqual(readSavedCreateForm().inputImages, ['/recipe.png']);
 assert.equal(readSavedCreateForm().fieldValues.prompt, 'recipe');
});
test('clearing prompt keeps attachments and reflects the empty value in compatibility storage', () => {
 reset(); advanced(); persistSavedCreateForm({ fieldValues: { prompt: '' } });
 assert.equal(window.localStorage.getItem('create_page_prompt'), '');
 assert.equal(readSavedCreateForm().fieldValues.prompt, '');
 assert.deepEqual(readSavedCreateForm().inputImages, images);
});

test('recipe restoration stores original direct parents and discards stale image sources', () => {
 reset(); advanced();
 syncCreationDetailToAdvancedCreate({ serverId: 1, methodKey: 'replicate', args: { image_url: '/recipe.png' }, parentIds: [17, 18] });
 assert.deepEqual(readSavedCreateForm().recipeLineage, { images: ['/recipe.png'], parentIds: [17, 18] });
 assert.deepEqual(readSavedCreateForm().imageSources, {});
 syncCreationDetailToAdvancedCreate({ serverId: 1, methodKey: 'replicate', args: { image_url: '/single.png' }, mutateOfId: 19 });
 assert.deepEqual(readSavedCreateForm().recipeLineage.parentIds, [19]);
});
