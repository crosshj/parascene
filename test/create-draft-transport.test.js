import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
async function mount(fetch) {
 const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/create' });
 const w = dom.window;
 const context = vm.createContext({ window: w, document: w.document, sessionStorage: w.sessionStorage, localStorage: w.localStorage, navigator: w.navigator,
  HTMLElement: w.HTMLElement, File: w.File, AbortController: w.AbortController, CustomEvent: w.CustomEvent, DOMException: w.DOMException, Headers, URL, URLSearchParams,
  fetch, setTimeout, clearTimeout, console });
 const modules = new Map();
 const load = file => { file = path.resolve(file); if (!modules.has(file)) modules.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file })); return modules.get(file); };
 const entry = load('client/providers/create/index.js');
 await entry.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier))); await entry.evaluate();
 const host = modules.get(path.resolve('client/shared/createWorkflowHost.js')).namespace;
 host.setCreateWorkflowHost({ root: w.document.getElementById('root'), pendingCreations: { key: 'test-pending' } });
 const provider = entry.namespace.createCreateProvider({ viewerId: 91 }); provider.workflow.enterMode({ mode: 'image-edit', prompt: 'hello' });
 provider.workflow.openSource({ imageUrl: '/a.png', sourceId: 17 });
 return { provider, w, close() { provider.destroy(); dom.window.close(); } };
}
test('real provider transport creates pending, posts snapshot and promotes accepted job', { skip: !vm.SourceTextModule }, async () => {
 const pending = deferred(); let posted; const app = await mount(async (url, options) => {
  if (url === '/api/create') { posted = JSON.parse(options.body); return pending.promise; }
  if (url.startsWith('/api/create/images')) return json({ images: [{ id: 91 }] });
  throw new Error('Unexpected endpoint: ' + url);
 });
 try {
  const result = app.provider.workflow.submit({ mode: 'image-edit', navigate: 'none' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(app.w.sessionStorage.getItem('test-pending'))[0].status, 'pending');
  assert.equal(posted.args.image_url, '/a.png'); assert.equal(posted.mutate_of_id, 17); assert.deepEqual(posted.mutate_parent_ids, [17]); assert.ok(posted.creation_token);
  pending.resolve(json({ id: 91, status: 'queued', credits_remaining: 12 }));
  assert.equal((await result).id, 91); assert.equal(JSON.parse(app.w.sessionStorage.getItem('test-pending'))[0].id, 91);
  assert.equal(app.provider.draft.read().fieldValues.prompt, ''); assert.equal(app.provider.draft.read().inputImages[0], '/a.png');
 } finally { app.close(); }
});
for (const [status, data, message] of [[402, { message: 'Insufficient credits', current: 1 }, 'Insufficient credits'], [503, { message: 'Credits are being updated. Please try again.', code: 'credits_busy' }, 'Credits are being updated'], [200, { id: 91, status: 'failed', meta: { error: 'Provider rejected input' } }, 'Provider rejected input']]) {
 test(`real transport handles ${status}/${data.status || 'error'} without clearing draft or leaving failed placeholder`, { skip: !vm.SourceTextModule }, async () => {
  const app = await mount(async () => json(data, status));
  try {
   await assert.rejects(app.provider.workflow.submit({ mode: 'image-edit', navigate: 'none' }), new RegExp(message));
   assert.deepEqual(JSON.parse(app.w.sessionStorage.getItem('test-pending')), []);
   assert.equal(app.provider.draft.read().fieldValues.prompt, 'hello'); assert.equal(app.provider.draft.read().inputImages[0], '/a.png');
  } finally { app.close(); }
 });
}
test('accepted creation survives view dismissal while a new draft remains intact', { skip: !vm.SourceTextModule }, async () => {
 const pending = deferred(); const app = await mount(async url => url === '/api/create' ? pending.promise : json({ images: [{ id: 91 }] }));
 const controller = new app.w.AbortController();
 try {
  const submitted = app.provider.workflow.submit({ mode: 'image-edit', navigate: 'none' }, { signal: controller.signal }); await new Promise(resolve => setImmediate(resolve));
  controller.abort(); app.provider.workflow.edit({ fieldValues: { prompt: 'next creation' } }); pending.resolve(json({ id: 91, status: 'creating' }));
  assert.equal((await submitted).id, 91); assert.equal(app.provider.draft.read().fieldValues.prompt, 'next creation');
  assert.equal(JSON.parse(app.w.sessionStorage.getItem('test-pending'))[0].id, 91);
 } finally { app.close(); }
});
test('account cache clearing prevents late submission from publishing old credits or overwriting new draft', { skip: !vm.SourceTextModule }, async () => {
 const pending = deferred(); const app = await mount(async url => url === '/api/create' ? pending.promise : json({ images: [{ id: 91 }] }));
 let creditUpdates = 0; app.w.document.addEventListener('credits-updated', () => creditUpdates++);
 try {
  const submission = app.provider.workflow.submit({ mode: 'image-edit', navigate: 'none' }); await new Promise(resolve => setImmediate(resolve));
  app.provider.clearCache(); app.provider.workflow.enterMode({ mode: 'basic', prompt: 'new account draft' }); pending.resolve(json({ id: 91, status: 'queued', credits_remaining: 55 }));
  await submission; assert.equal(creditUpdates, 0); assert.equal(app.provider.draft.read().fieldValues.prompt, 'new account draft');
 } finally { app.close(); }
});
