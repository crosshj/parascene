import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

test('mounted editors render shared state, submit mode projections, and release subscriptions', { skip: !vm.SourceTextModule }, async () => {
 const dom = new JSDOM('<div class="create-workflow-root create-page-advanced" id="root"></div>', { url: 'http://localhost/create', pretendToBeVisual: true });
 const w = dom.window;
 class Observer { observe() {} disconnect() {} unobserve() {} }
 const globals = ['document','Document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLButtonElement','HTMLAnchorElement','HTMLImageElement','Element','Node','Image','File','Event','CustomEvent','AbortController','AbortSignal','customElements','localStorage','sessionStorage','navigator','location','MutationObserver'];
 const context = vm.createContext({ ...Object.fromEntries(globals.map(key => [key, w[key]])), window: w,
  console, URL, URLSearchParams, CSS: { escape: value => value }, getComputedStyle: w.getComputedStyle.bind(w),
  ResizeObserver: Observer, IntersectionObserver: Observer, requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w),
  setTimeout, clearTimeout, queueMicrotask, fetch: async () => new Response('{}', { status: 200 }), alert() {}, confirm: () => true });
 w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
 const modules = new Map();
 function load(file) {
  file = path.resolve(file); if (modules.has(file)) return modules.get(file);
  let code = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.css')) code = 'export default {};';
  if (file.endsWith('.html')) code = `export default ${JSON.stringify(code)};`;
  const module = new vm.SourceTextModule(code, { context, identifier: file }); modules.set(file, module); return module;
 }
 const base = path.resolve('client');
 async function evaluate(file) {
  const module = load(path.join(base, file));
  if (module.status === 'unlinked') await module.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier)));
  if (module.status !== 'evaluated') await module.evaluate();
  return module.namespace;
 }
 try {
  await evaluate('views/Create/AdvancedCreate.js');
  const basic = await evaluate('views/Create/BasicCreate.js');
  const settings = await evaluate('shared/createSettingsSync.js');
  const queue = await evaluate('shared/mutateQueueSync.js');
  const host = await evaluate('shared/createWorkflowHost.js');
  const images = ['/one.png', '/two.png', '/three.png'];
  settings.persistSavedCreateForm({ serverId: 1, methodKey: 'replicate', fieldValues: { prompt: 'original', model: 'multi' }, imageChange: { type: 'replace', images } });
  queue.syncSavedCreateImagesToQueue();
  const server = { id: 1, name: 'Test', server_config: { methods: { replicate: { label: 'Images', fields: {
   model: { type: 'select', default: 'multi', options: [{ value: 'multi', label: 'Multi', fields: { input_images: { type: 'image_url_array', label: 'Input images' } } }] },
   prompt: { type: 'textarea', label: 'Prompt' }
  } } } } };
  const provider = { getCreateServersPaint: () => ({ servers: [server], source: 'cache', shouldRefresh: false }), serversListSame: () => true,
   refreshCreateServersFromNetwork: async () => ({ ok: true, servers: [server] }), api: { request: async () => new Response('{}') }, stageAdvancedDraft() {} };
  const workflowModule = await evaluate('providers/create/workflow.js');
  let activeSubscriptions = 0;
  const submissions = [];
  provider.draft = { read: settings.readSavedCreateForm, update: settings.persistSavedCreateForm, subscribe(callback) { activeSubscriptions++; const stop = settings.getSavedCreateDraftStore().subscribe(callback); return () => { activeSubscriptions--; stop(); }; } };
  provider.workflow = workflowModule.createCreationWorkflow({ draft: provider.draft, request: provider.api.request, send: async payload => { submissions.push(payload); return { id: 1 }; }, upload: async () => '/uploaded.png' });
  const root = w.document.getElementById('root');
  host.setCreateWorkflowHost({ root, onNavigate() {} });
  const mountAdvanced = async () => {
   const element = w.document.createElement('app-route-create'); element.createProvider = provider;
   element.creditsProvider = { query: { data: { balance: 100 }, getSnapshot: () => ({ data: { balance: 100 } }), loadIfNeeded: async () => {}, subscribe: () => () => {} } };
   root.append(element); await element.ready; return element;
  };
  let advanced = await mountAdvanced();
  assert.deepEqual(JSON.parse(JSON.stringify(advanced.fieldValues.input_images)), images);
  await advanced.persistImageForBasicMode(); advanced.remove();
  root.classList.remove('create-page-advanced'); root.classList.add('create-page');
  const markup = '<div class="create-content"><app-tabs active="image-edit"><tab data-id="text-to-image"><textarea class="create-prompt-input"></textarea><button class="create-btn-generate">Create</button></tab><tab data-id="image-edit"><div class="create-image-edit-box"><div class="create-image-edit-area"><span class="create-image-edit-placeholder"></span></div></div><textarea class="create-prompt-input"></textarea><button class="create-btn-generate">Edit</button></tab></app-tabs></div>';
  const cleanup = await basic.mountBasicCreateWorkflow(root, { markup, createProvider: provider });
  const prompt = root.querySelector('tab[data-id="image-edit"] textarea'); prompt.value = 'from basic'; prompt.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.deepEqual(JSON.parse(JSON.stringify(settings.readSavedCreateForm().inputImages)), images);
  assert.equal(settings.readSavedCreateForm().fieldValues.prompt, 'from basic');
  assert.match(root.querySelector('.create-image-edit-thumb').src, /one\.png/);
  const tabs = root.querySelector('app-tabs');
  tabs.setActiveTab('text-to-image', { focus: false });
  assert.equal(provider.draft.read().mode, 'basic');
  assert.equal(root.querySelector('tab[data-id="text-to-image"] textarea').value, 'from basic');
  assert.deepEqual(JSON.parse(JSON.stringify(provider.draft.read().inputImages)), []);
  assert.equal(root.querySelector('.create-image-edit-thumb'), null);
  tabs.setActiveTab('image-edit', { focus: false });
  await provider.workflow.selectImages(images);
  root.querySelectorAll('.create-btn-generate')[1].click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(submissions.at(-1).args.image_url, '/one.png');
  assert.equal(submissions.at(-1).args.input_images, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(provider.draft.read().inputImages)), images);
  assert.equal(prompt.value, '');
  prompt.value = 'from basic'; prompt.dispatchEvent(new w.Event('input', { bubbles: true }));
  cleanup(); root.classList.remove('create-page'); root.classList.add('create-page-advanced');
  advanced = await mountAdvanced();
  assert.deepEqual(JSON.parse(JSON.stringify(advanced.fieldValues.input_images)), images);
  assert.equal(advanced.fieldValues.prompt, 'from basic');
  await advanced.handleCreateAfterSpinner(advanced.querySelector('[data-create-button]'));
  assert.deepEqual(JSON.parse(JSON.stringify(submissions.at(-1).args.input_images)), images);
  assert.equal(submissions.at(-1).args.prompt, 'from basic');
  advanced.remove();
  assert.equal(activeSubscriptions, 0);
  // Exercise the actual Mutate mount and its source-storage update as well.
  const mutateModule = await evaluate('views/Create/MutateCreate.js');
  context.Image = function() {
   const image = new w.Image();
   Object.defineProperty(image, 'src', { set() { queueMicrotask(() => image.onerror?.()); } });
   return image;
  };
  server.server_config.methods.replicate.credits = 2;
  provider.api.request = async () => new Response(JSON.stringify({ id: 91, status: 'completed', url: '/mutate.png', width: 1024, height: 1024 }));
  root.classList.remove('create-page-advanced'); root.classList.add('creation-edit-page', 'create-page');
  const mutate = mutateModule.createMutateWorkflow({ root, creationId: 91, providers: { create: provider,
   credits: { query: { data: { balance: 100 }, getSnapshot: () => ({ data: { balance: 100 } }), loadIfNeeded: async () => {}, subscribe: () => () => {} } } } });
  await mutate.ready;
  assert.deepEqual(JSON.parse(JSON.stringify(settings.readSavedCreateForm().inputImages)), ['http://localhost/mutate.png']);
  const mutatePrompt = root.querySelector('[data-edit-prompt]');
  assert.ok(mutatePrompt, root.textContent);
  mutatePrompt.value = 'changed on mutate'; mutatePrompt.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(settings.readSavedCreateForm().fieldValues.prompt, 'changed on mutate');
  root.querySelector('[data-generate-btn]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(submissions.at(-1).args.image_url, 'http://localhost/mutate.png');
  assert.equal(submissions.at(-1).mutateOfId, 91);
  mutate.destroy();
  assert.equal(activeSubscriptions, 0);
 } finally { dom.window.close(); }
});
