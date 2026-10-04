import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { createAvatarsProvider } from '../client/providers/avatars/index.js';
const avatar = '/api/images/generic/profile/7/avatar_123_test.webp';
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
function databaseFixture(rows) {
 const db = { close() {}, transaction() {
  const tx = { objectStore: () => ({ get: key => request(() => rows.get(key)), put: row => request(() => { rows.set(row.url, row); return row.url; }), delete: key => request(() => rows.delete(key)), openCursor: () => request(() => null) }) };
  function request(action) { const req = {}; setTimeout(() => { req.result = action(); req.onsuccess?.({ target: req }); tx.oncomplete?.(); }, 0); return req; }
  return tx;
 } };
 return { open() { const req = {}; setTimeout(() => { req.result = db; req.onsuccess(); }, 0); return req; } };
}
test('persisted blobs avoid HTTP, misses deduplicate, and failures fall back once', async () => {
 const dom = new JSDOM('<main></main>', { url: 'http://localhost:3000/' });
 const previous = new Map();
 for (const key of ['window', 'document', 'HTMLImageElement', 'MutationObserver']) { previous.set(key, globalThis[key]); globalThis[key] = dom.window[key]; }
 Object.defineProperty(window, 'indexedDB', { value: databaseFixture(new Map()) });
 let calls = 0;
 const fetchImpl = async () => { calls++; return new Response(new Blob(['avatar'], { type: 'image/webp' })); };
 const mount = (url = avatar) => { const image = document.createElement('img'); image.dataset.avatarSrc = url; document.querySelector('main').append(image); return image; };
 let provider;
 try {
  provider = createAvatarsProvider({ fetchImpl }); provider.start();
  const one = mount(), two = mount(); assert.equal(one.hasAttribute('src'), false);
  await tick(); await tick(); assert.equal(calls, 1); assert.match(one.src, /^blob:/); assert.equal(one.src, two.src);
  provider.destroy(); document.querySelector('main').replaceChildren();
  provider = createAvatarsProvider({ fetchImpl }); provider.start();
  const cached = mount(); await tick(); await tick(); assert.equal(calls, 1); assert.match(cached.src, /^blob:/);
  const invalid = mount('null'); await tick(); assert.equal(invalid.hasAttribute('src'), false);
  provider.destroy(); document.querySelector('main').replaceChildren();
  let failures = 0;
  provider = createAvatarsProvider({ fetchImpl: async () => { failures++; throw new Error('CORS'); } }); provider.start();
  const failedUrl = avatar.replace('123', '456'); const fallback = mount(failedUrl);
  await tick(); await tick(); assert.equal(fallback.getAttribute('src'), `http://localhost:3000${failedUrl}`);
  mount(failedUrl); await tick(); assert.equal(failures, 1);
 } finally { provider?.destroy(); dom.window.close(); for (const [key, value] of previous) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});
test('sidebar refresh preserves cached src and never assigns null', () => {
 const source = fs.readFileSync(new URL('../client/views/Sidebar/SidebarView.js', import.meta.url), 'utf8');
 const fn = source.slice(source.indexOf('function patchRosterRow('), source.indexOf('\nfunction mountSidebarPresentation'));
 const patch = vm.runInNewContext(`(${fn})`); const dom = new JSDOM();
 const row = url => { const node = dom.window.document.createElement('div'); node.innerHTML = `<a class="sidebar-view__row-link" href="/chat"><span class="ps-avatar"><img data-avatar-src="${url}"></span><span class="sidebar-view__row-label">Name</span></a><button class="sidebar-view__row-menu"></button>`; return node; };
 const live = row(avatar); live.querySelector('img').src = 'blob:cached';
 patch(live, row(avatar)); assert.equal(live.querySelector('img').getAttribute('src'), 'blob:cached');
 patch(live, row('/new-avatar.webp')); assert.equal(live.querySelector('img').hasAttribute('src'), false); assert.equal(live.querySelector('img').dataset.avatarSrc, '/new-avatar.webp'); dom.window.close();
});
