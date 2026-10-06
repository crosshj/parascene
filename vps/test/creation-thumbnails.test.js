import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreationThumbnails } from '../client/providers/creations/thumbnails.js';
const origin = 'https://parascene.test';
const thumb = id => `${origin}/api/creations/media/${id}.png?creation_id=${id}&variant=thumbnail`;
const response = () => new Response(new Blob(['thumbnail'], { type: 'image/png' }));
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
function setup(overrides = {}) {
 const databases = new Map(), revoked = [];
 let calls = 0, nextUrl = 0;
 const indexedDB = { open(name) {
  const rows = databases.get(name) || new Map(); databases.set(name, rows);
  const request = {};
  setTimeout(() => {
   request.result = { close() {}, transaction() {
    const tx = { objectStore: () => ({ get: key => run(() => rows.get(key)), put: (value, key) => run(() => rows.set(key, value)), delete: key => run(() => rows.delete(key)) }) };
    function run(action) { const req = {}; setTimeout(() => { req.result = action(); tx.oncomplete?.(); }, 0); return req; }
    return tx;
   } }; request.onsuccess();
  }, 0); return request;
 } };
 const options = { viewerId: 26, origin, indexedDB,
  urlApi: { createObjectURL: () => `blob:${++nextUrl}`, revokeObjectURL: url => revoked.push(url) },
  fetchImpl: async () => { calls++; return response(); }, ...overrides };
 return { options, databases, revoked, calls: () => calls, create: () => createCreationThumbnails(options) };
}
test('deduplicates downloads and reuses persisted thumbnails after teardown', async () => {
 const h = setup(); let cache = h.create(); cache.retain([thumb(1)]);
 const [one, two] = await Promise.all([cache.resolve(thumb(1)), cache.resolve(thumb(1))]);
 assert.match(one, /^blob:/); assert.equal(one, two); assert.equal(h.calls(), 1);
 cache.destroy(); await tick(); cache = h.create(); cache.retain([thumb(1)]);
 assert.match(await cache.resolve(thumb(1)), /^blob:/); assert.equal(h.calls(), 1); cache.destroy();
});
test('keeps only newest 30 URLs and distinguishes variants', async () => {
 const h = setup(), cache = h.create(); const urls = Array.from({ length: 31 }, (_, i) => thumb(i + 1));
 cache.retain(urls); for (const url of urls) await cache.resolve(url);
 assert.equal(h.calls(), 30); assert.equal(await cache.resolve(urls[30]), urls[30]);
 cache.retain([thumb(32), ...urls]); await cache.resolve(thumb(32)); await tick();
 for (let i = 0; i < 100 && ![...h.databases.values()][0].get('recent')?.some(([url]) => url === thumb(32)); i++) await tick();
 const rows = [...h.databases.values()][0].get('recent');
 assert.equal(rows.length, 30); assert.equal(rows.some(([url]) => url === thumb(30)), false); assert.equal(h.revoked.length, 1);
 const blur = thumb(1).replace('variant=thumbnail', 'variant=blur'); cache.retain([blur]);
 assert.match(await cache.resolve(blur), /^blob:/); assert.equal(h.calls(), 32);
 assert.equal(await cache.resolve(thumb(1)), thumb(1)); cache.destroy();
});
test('isolates viewers and clears persisted blobs on logout', async () => {
 const h = setup(), cache = h.create(); cache.retain([thumb(1)]); await cache.resolve(thumb(1)); await tick();
 const other = createCreationThumbnails({ ...h.options, viewerId: 27 }); other.retain([thumb(1)]); await other.resolve(thumb(1)); assert.equal(h.calls(), 2);
 await cache.clearCache(); assert.equal([...h.databases.values()][0].has('recent'), false);
 assert.equal(await cache.resolve(thumb(1)), thumb(1));
 const fresh = h.create(); fresh.retain([thumb(1)]); await fresh.resolve(thumb(1)); assert.equal(h.calls(), 3);
 cache.destroy(); other.destroy(); fresh.destroy();
});
test('late downloads cannot repopulate after logout or eviction', async () => {
 for (const logout of [true, false]) {
  let finish, signal;
  const h = setup({ fetchImpl: (_url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); } });
  const cache = h.create(); cache.retain([thumb(1)]); const result = cache.resolve(thumb(1)); await tick();
  if (logout) await cache.clearCache(); else cache.retain([thumb(2)]);
  assert.equal(signal.aborted, true); finish(response()); assert.equal(await result, thumb(1)); await tick();
  assert.equal(([...h.databases.values()][0].get('recent') || []).length, 0); cache.destroy();
 }
});
test('failures fall back; missing storage works; full images bypass the cache', async () => {
 for (const fetchImpl of [async () => { throw Error('offline'); }, async () => new Response('login'), async () => new Response('', { status: 403 })]) {
  const h = setup({ fetchImpl }), cache = h.create(); cache.retain([thumb(1)]);
  assert.equal(await cache.resolve(thumb(1)), thumb(1)); cache.destroy();
 }
 const h = setup({ indexedDB: null }), cache = h.create(); cache.retain([thumb(1)]);
 assert.match(await cache.resolve(thumb(1)), /^blob:/);
 const full = thumb(1).replace('&variant=thumbnail', ''); cache.retain([full, 'https://elsewhere.test/image.png']);
 assert.equal(await cache.resolve(full), full); assert.equal(h.calls(), 1); cache.destroy();
});
test('invalidating an unusable cached image removes its blob', async () => {
 const h = setup(), cache = h.create(); cache.retain([thumb(1)]); await cache.resolve(thumb(1)); await cache.invalidate(thumb(1));
 assert.equal([...h.databases.values()][0].get('recent').length, 0);
 await cache.resolve(thumb(1)); assert.equal(h.calls(), 2); cache.destroy();
});
