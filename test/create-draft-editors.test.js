import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { persistSavedCreateForm, readSavedCreateForm, getSavedCreateDraftStore, mergeSharedSettingsIntoSessionSelections } from '../client/shared/createSettingsSync.js';
import { persistMutateForm, syncMutateSourceToCreateStorage, syncMutatePageToAdvancedCreate, syncSavedCreateImagesToQueue, syncCreationDetailToAdvancedCreate, syncMutateQueueFromComposerAttachments } from '../client/shared/mutateQueueSync.js';
import { addToMutateQueue, loadMutateQueue } from '../client/shared/mutateQueue.js';
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
test('advanced mutate handoff retains the selected group context for server authorization', () => {
 reset();
 syncMutateSourceToCreateStorage({ imageUrl: '/group-source.png', sourceId: 91, groupId: 72, published: false });
 assert.equal(loadMutateQueue()[0].groupId, 72);
 syncMutatePageToAdvancedCreate({ mode: 'image-to-image', imageUrl: '/group-source.png', sourceId: 91, groupId: 72 });
 const draft = readSavedCreateForm();
 assert.equal(draft.imageSources['/group-source.png'].sourceId, 91);
 assert.equal(draft.imageSources['/group-source.png'].groupId, 72);
 assert.equal(draft.inputs[0].source.groupId, 72);
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
 syncMutateQueueFromComposerAttachments(['/new.png', '/second.png'], [17, 18], [70, 71]);
 assert.deepEqual(readSavedCreateForm().inputImages, ['/new.png', '/second.png']);
 assert.deepEqual(loadMutateQueue().map(item => item.sourceId), [17, 18]);
 assert.deepEqual(loadMutateQueue().map(item => item.groupId), [70, 71]);
});
test('composer consumes a queued frame as its uploaded still, not the parent image', () => {
 reset();
 const frame = 'https://cdn.parascene.com/api/images/generic/edited/7/frame.png';
 addToMutateQueue({ sourceId: 93, imageUrl: frame, fromFrame: true, frameTimeSec: 2.5 });
 syncMutateQueueFromComposerAttachments([frame], [93], [null]);
 const input = readSavedCreateForm().inputs[0];
 assert.equal(input.source.kind, 'derived-still');
 assert.equal(input.source.url, frame);
 assert.equal(input.source.parentCreationId, 93);
 assert.equal(input.source.frameTimeSec, 2.5);
});
test('reusing a creation recipe explicitly replaces input attachments rather than using its output', () => {
 reset(); advanced();
 syncCreationDetailToAdvancedCreate({ serverId: 1, methodKey: 'replicate', args: { model: 'xai/grok-imagine-image', prompt: 'recipe', input_images: ['/recipe.png'] } });
 assert.deepEqual(readSavedCreateForm().inputImages, ['/recipe.png']);
 assert.equal(readSavedCreateForm().fieldValues.prompt, 'recipe');
});
test('recreating a grouped source retains its group authorization context', () => {
 reset();
 syncCreationDetailToAdvancedCreate({ serverId: 1, methodKey: 'replicate', mutateGroupId: 72, mutateOfId: 91, args: { model: 'xai/grok-imagine-image', prompt: 'recipe', input_images: ['/recipe.png'] } });
 const draft = readSavedCreateForm();
 assert.equal(draft.inputs[0].source.member.creationId, 91);
 assert.equal(draft.inputs[0].source.groupId, 72);
});
test('Recreate keeps the recipe source group when its output belongs to another group', () => {
 reset();
 syncCreationDetailToAdvancedCreate({ serverId: 1, methodKey: 'replicate', recreateOf: 120,
  args: { image_url: '/api/share/v1/source/image', prompt: 'recipe' },
  inputRecipe: { version: 1, inputs: [{ id: 'a', source: { kind: 'group-member', groupId: 72, member: { kind: 'creation', creationId: 91 } }, media: { kind: 'image' }, revision: 'a.png:123' }],
   bindings: [{ field: 'image_url', attachmentIds: ['a'] }] } });
 const draft = readSavedCreateForm();
 assert.equal(draft.inputs[0].source.groupId, 72);
 assert.equal(draft.inputs[0].source.member.creationId, 91);
 assert.equal(draft.inputs[0].media.revision, 'a.png:123');
 assert.equal(draft.recreateOf, 120);
});
test('clearing prompt keeps attachments and reflects the empty value in compatibility storage', () => {
 reset(); advanced(); persistSavedCreateForm({ fieldValues: { prompt: '' } });
 assert.equal(window.localStorage.getItem('create_page_prompt'), '');
 assert.equal(readSavedCreateForm().fieldValues.prompt, '');
 assert.deepEqual(readSavedCreateForm().inputImages, images);
});

test('recipe restoration stores original direct parents and discards stale image sources', () => {
 reset(); advanced();
 assert.throws(() => syncCreationDetailToAdvancedCreate({ serverId: 1, methodKey: 'replicate', args: { image_url: '/recipe.png' }, parentIds: [17, 18] }), /cannot be identified/);
 syncCreationDetailToAdvancedCreate({ serverId: 1, methodKey: 'replicate', args: { image_url: '/single.png' }, mutateOfId: 19 });
 assert.equal(readSavedCreateForm().inputs[0].source.creationId, 19);
 assert.deepEqual(readSavedCreateForm().imageSources, {});
});
