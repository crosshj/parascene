import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {JSDOM} from 'jsdom';
async function harness(url,fetcher,{mobile=false}={}){const dom=new JSDOM('<div class="beta-outlet__scroll"><div id="outlet"></div></div>',{url:'http://localhost'+url,pretendToBeVisual:true}),w=dom.window;w.HTMLElement.prototype.scrollTo=function(){};const observers=[];class Observer{constructor(callback,options){this.callback=callback;this.options=options;this.targets=new Set();this.disconnected=false;observers.push(this)}observe(target){this.targets.add(target)}unobserve(target){this.targets.delete(target)}disconnect(){this.disconnected=true}}w.confirm=()=>true;w.matchMedia=()=>({matches:mobile,addEventListener(){},removeEventListener(){}});w.HTMLMediaElement.prototype.play=async function(){};w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};const names=['document','Document','HTMLElement','HTMLDivElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLButtonElement','HTMLAnchorElement','HTMLImageElement','HTMLTemplateElement','HTMLFormElement','HTMLMediaElement','HTMLAudioElement','HTMLVideoElement','Element','SVGElement','Node','Image','File','FormData','Event','CustomEvent','DOMException','AbortController','AbortSignal','customElements','localStorage','sessionStorage','navigator','location','MutationObserver'];const context=vm.createContext({...Object.fromEntries(names.map(n=>[n,w[n]])),window:w,innerWidth:w.innerWidth,innerHeight:w.innerHeight,matchMedia:w.matchMedia,console,URL,URLSearchParams,CSS:{escape:v=>v},getComputedStyle:w.getComputedStyle.bind(w),IntersectionObserver:Observer,ResizeObserver:Observer,requestAnimationFrame:w.requestAnimationFrame.bind(w),cancelAnimationFrame:w.cancelAnimationFrame.bind(w),setTimeout,clearTimeout,setInterval:w.setInterval.bind(w),clearInterval:w.clearInterval.bind(w),queueMicrotask,fetch:fetcher,alert(){},confirm:()=>true});const modules=new Map();function module(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);let code=fs.readFileSync(file,'utf8');if(file.endsWith('.css'))code='export default {}';if(file.endsWith('.html'))code='export default '+JSON.stringify(code);const mod=new vm.SourceTextModule(code,{identifier:file,context});modules.set(file,mod);return mod}async function load(file){const mod=module(path.resolve('client',file));if(mod.status==='unlinked')await mod.link((name,parent)=>module(path.resolve(path.dirname(parent.identifier),name)));if(mod.status!=='evaluated')await mod.evaluate();return mod.namespace}const navigations=[],actions={navigate:(...args)=>navigations.push(args),dismissOverlay(){}},services={session:{user:{id:1,role:'consumer',meta:{}},redirectToLogin(){throw Error('Unexpected auth redirect')},refresh:async()=>{}},providers:{}};const searchComposer=(await load('components/SearchComposer/SearchComposer.js')).createSearchComposerElement();w.document.body.append(searchComposer);return {w,load,searchComposer,outlet:w.document.getElementById('outlet'),actions,services,navigations,observers,close:()=>dom.window.close()}}
const tick=()=>new Promise(resolve=>setImmediate(resolve)),response=data=>new Response(JSON.stringify(data),{headers:{"content-type":"application/json"}});

function pointer(w, target, type, props = {}) {
 const event = new w.Event(type, { bubbles: true, cancelable: true });
 Object.assign(event, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10, ...props }); target.dispatchEvent(event);
}
function cachedQuery(data) {
 const listeners = new Set();
 return { data, subscribe(fn) { listeners.add(fn); fn({ data: this.data }); return () => listeners.delete(fn); }, setData(next) { this.data = next; for (const fn of listeners) fn({ data: next }); }, async loadIfNeeded() {}, async refresh() {} };
}
const checkbox = card => card.querySelector('[data-creations-bulk-checkbox]');
const button = (root, id) => root.querySelector(`[data-creations-bulk-${id}]`);

test('Creations desktop menu selection survives metadata refresh, protects published/challenge rows and retires successful deletes before retry', { skip: !vm.SourceTextModule }, async () => {
 const h = await harness('/creations', async () => response({})); let dispose;
 try {
  const { renderCreationsView } = await h.load('views/Creations/CreationsView.js');
  const rows = [1,2,3,4].map(id => ({ id, status: 'completed', url: `/${id}.png`, published: id === 3, meta: id === 4 ? { challenge_submissions: [{ challenge_id: 9 }] } : {} }));
  const query = cachedQuery({ creations: rows, has_more: false });
  let menu, opened = [], deleted = [], fail = true;
  dispose = renderCreationsView({ outlet: h.outlet, creationsQuery: query, creationsApi: {
   async remove(id) { deleted.push(id); if (id === 2 && fail) throw new Error('Please retry'); },
  }, setHeaderMenu(value) { menu = value; }, onOpenCreation: id => opened.push(id) });
  const cards = () => [...h.outlet.querySelectorAll('.creation-grid__card')];
  cards()[0].dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
  assert.ok(h.outlet.querySelector('.creations-view').classList.contains('is-bulk-mode'));
  assert.equal(checkbox(cards()[0]).checked, true);
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  cards()[0].querySelector('img').click(); assert.deepEqual(opened, [1]);
  menu.onSelect({ action: 'bulk' });
  for (const card of cards()) card.querySelector('img').click();
  assert.deepEqual(opened, [1]); assert.equal(cards().filter(card => checkbox(card).checked).length, 4);
  const first = cards()[0];
  query.setData({ creations: rows.map(row => ({ ...row, title: 'Changed' })), has_more: false });
  assert.equal(cards()[0], first); assert.equal(cards().filter(card => checkbox(card).checked).length, 4);
  assert.equal(button(h.outlet, 'group').disabled, true);
  button(h.outlet, 'delete').click(); await tick();
  const dialog = h.outlet.querySelector('dialog'); assert.equal(dialog.open, true);
  assert.match(dialog.textContent, /2 items will be deleted/); assert.match(dialog.textContent, /1 published item/); assert.match(dialog.textContent, /1 challenge entry/);
  button(h.outlet, 'delete-confirm').click(); await tick();
  assert.deepEqual(deleted, [1,2]); assert.deepEqual(cards().map(card => Number(card.dataset.creationId)), [2,3,4]);
  assert.match(button(h.outlet, 'delete-error').textContent, /Please retry/); assert.equal(dialog.open, true);
  fail = false; button(h.outlet, 'delete-confirm').click(); await tick();
  assert.deepEqual(deleted, [1,2,2]); assert.equal(dialog.open, false);
  assert.deepEqual(query.data.creations.map(row => row.id), [3,4]);
  h.w.document.dispatchEvent(new h.w.CustomEvent('creation-detail:mutation', { detail: { reason: 'deleted', creationId: 3 } }));
  assert.deepEqual(cards().map(card => Number(card.dataset.creationId)), [4]);
 } finally { dispose?.(); h.close(); }
});

test('mobile hold uses WWW 420ms threshold, cancels on movement, suppresses opening and releases owned work', { skip: !vm.SourceTextModule }, async t => {
 t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
 const h = await harness('/creations', async () => response({}), { mobile: true }); let bulk;
 try {
  const { createBulkActions } = await h.load('components/BulkActions/BulkActions.js');
  h.outlet.innerHTML = '<div id="grid"><div data-card="1"><img></div></div>';
  const grid = h.outlet.querySelector('#grid'), card = grid.firstElementChild, img = card.firstElementChild;
  let opened = 0; card.addEventListener('click', () => opened++);
  bulk = createBulkActions({ root: h.outlet, grid, cardSelector: '[data-card]', getItem: el => ({ id: el.dataset.card }), remove() {} }); bulk.sync();
  pointer(h.w, img, 'pointerdown'); t.mock.timers.tick(419); assert.equal(bulk.active, false);
  pointer(h.w, img, 'pointermove', { clientX: 30 }); t.mock.timers.tick(5); assert.equal(bulk.active, false);
  pointer(h.w, img, 'pointerdown'); t.mock.timers.tick(420); assert.equal(bulk.active, true); assert.equal(checkbox(card).checked, true);
  img.click(); assert.equal(opened, 0); assert.equal(checkbox(card).checked, true);
  pointer(h.w, img, 'pointerup'); bulk.destroy(); bulk = null;
  img.click(); assert.equal(opened, 1, 'destroy removes document ghost-click interceptor');
 } finally { bulk?.destroy(); h.close(); }
});

test('My Files uses the same menu, checkboxes, queue and delete flow; deleting the last page adjusts pagination and empty state', { skip: !vm.SourceTextModule }, async () => {
 const h = await harness('/files', async () => response({})); let dispose;
 try {
  const { renderFileManagerView } = await h.load('views/FileManager/FileManagerView.js');
  const files = [1,2].map(id => ({ id: `${id}.png`, content_type: 'image/png', public_url: `https://cdn.parascene.com/s/token/${id}.png`, display_name: `Image ${id}` }));
  const query = cachedQuery({ files, pagination: { offset: 0, next_offset: 2 } }); let menu, deleted = [];
  dispose = renderFileManagerView({ outlet: h.outlet, filesQuery: query, filesApi: { url: x => x, async remove(id) { deleted.push(id); } }, setHeaderMenu: value => { menu = value; } });
  const cards = () => [...h.outlet.querySelectorAll('.file-card')];
  cards()[0].dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
  assert.ok(h.outlet.querySelector('.file-manager-view').classList.contains('is-bulk-mode'));
  assert.equal(checkbox(cards()[0]).checked, true);
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  menu.onSelect({ action: 'bulk' }); checkbox(cards()[0]).click();
  assert.equal(checkbox(cards()[0]).checked, true);
  button(h.outlet, 'queue').click(); await tick();
  assert.equal(JSON.parse(h.w.localStorage.getItem('mutateQueue:v1'))[0].imageUrl, files[0].public_url);
  menu.onSelect({ action: 'bulk' });
  cards()[0].dispatchEvent(new h.w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })); cards()[1].click();
  button(h.outlet, 'delete').click(); await tick();
  assert.match(button(h.outlet, 'delete-message').textContent, /permanently deleted/);
  button(h.outlet, 'delete-cancel').click(); assert.deepEqual(deleted, []);
  button(h.outlet, 'delete').click(); await tick(); button(h.outlet, 'delete-confirm').click(); await tick();
  assert.deepEqual(deleted, ['1.png', '2.png']); assert.equal(cards().length, 0);
  assert.equal(query.data.pagination.next_offset, 0); assert.equal(h.outlet.querySelector('[data-ref="status"]').hidden, false);
 } finally { dispose?.(); h.close(); }
});

test('bulk unmount aborts pending deletes and ignores a late response', { skip: !vm.SourceTextModule }, async () => {
 const h = await harness('/files', async () => response({})); let bulk;
 try {
  const { createBulkActions } = await h.load('components/BulkActions/BulkActions.js');
  h.outlet.innerHTML = '<div id="grid"><div data-card="1"></div></div>';
  const grid = h.outlet.querySelector('#grid'); let finish, requestSignal, removed = 0;
  bulk = createBulkActions({ root: h.outlet, grid, cardSelector: '[data-card]', getItem: el => ({ id: el.dataset.card }), remove: (_, { signal }) => { requestSignal = signal; return new Promise(resolve => { finish = resolve; }); }, onRemoved() { removed++; } });
  bulk.enter(); grid.firstElementChild.click(); button(h.outlet, 'delete').click(); await tick(); button(h.outlet, 'delete-confirm').click();
  bulk.destroy(); bulk = null; assert.equal(requestSignal.aborted, true); finish(); await tick(); assert.equal(removed, 0);
 } finally { bulk?.destroy(); h.close(); }
});

test('creation grouping and queue eligibility match WWW and use its API payload', { skip: !vm.SourceTextModule }, async () => {
 const h = await harness('/creations', async () => response({}));
 try {
  const { canGroupCreations, creationBulkActions } = await h.load('views/Creations/bulkActions.js');
  const items = [1,2].map(id => ({ id, type: 'image', status: 'completed', imageUrl: `/${id}.png`, published: false }));
  assert.equal(canGroupCreations(items), true);
  for (const patch of [{ type: 'video' }, { status: 'queued' }, { published: true }, { challenge: true }]) assert.equal(canGroupCreations([items[0], { ...items[1], ...patch }]), false);
  assert.equal(canGroupCreations(items.map(item => ({ ...item, group: true }))), false);
  let ids, refreshed = false;
  const actions = creationBulkActions({ api: { async group(value) { ids = [...value]; } }, refresh: async () => { refreshed = true; } });
  await actions.find(action => action.id === 'group').run(items, {}); assert.deepEqual(ids, [1,2]); assert.equal(refreshed, true);
  actions.find(action => action.id === 'queue').run(items);
  assert.deepEqual(JSON.parse(h.w.localStorage.getItem('mutateQueue:v1')).map(item => item.sourceId), [2,1]);
 } finally { h.close(); }
});

test('deletion while Creations is unmounted updates persisted provider data and cannot be revived by an older request', { skip: !vm.SourceTextModule }, async () => {
 let finish;
 const h = await harness('/feed', () => new Promise(resolve => { finish = resolve; })); let provider;
 try {
  const { createCreationsProvider } = await h.load('providers/creations/index.js');
  provider = createCreationsProvider({ viewerId: 7, registry: { acquire(_key, factory) { return { query: factory() }; } } });
  provider.query.setData({ creations: [{ id: 1 }, { id: 2 }], has_more: false });
  const pending = provider.query.refresh(); await tick();
  h.w.document.dispatchEvent(new h.w.CustomEvent('creation-detail:mutation', { detail: { reason: 'deleted', creationId: 1 } })); await tick();
  assert.deepEqual([...provider.query.data.creations].map(row => row.id), [2]);
  finish(response({ creations: [{ id: 1 }, { id: 2 }], has_more: false })); await pending;
  assert.deepEqual([...provider.query.data.creations].map(row => row.id), [2]);
  const saved = JSON.parse(h.w.localStorage.getItem('prsn-vps-creations-v1:7'));
  assert.deepEqual(saved.data.creations.map(row => row.id), [2]);
 } finally { provider?.destroy(); h.close(); }
});
