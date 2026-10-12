const LIMIT = 30;
const STORE = 'thumbnails';

// One bounded snapshot per viewer. IndexedDB stores blobs without base64 overhead.
export function createCreationThumbnails({ viewerId, fetchImpl = (...args) => fetch(...args), indexedDB = globalThis.indexedDB, urlApi = URL, origin = globalThis.location?.origin } = {}) {
 let allowed = new Set();
 const blobs = new Map();
 const objectUrls = new Map();
 const pending = new Map();
 let stopped = !viewerId;
 let dbPromise;
 let writeQueue = Promise.resolve();
 const controller = new AbortController();

 function canonical(value) {
  try {
   const url = new URL(value, origin);
   return url.origin === origin && url.pathname.startsWith('/api/creations/media/') &&
    ['thumbnail', 'grid_thumbnail', 'fit', 'blur', 'video_thumbnail'].includes(url.searchParams.get('variant')) ? url.href : '';
  } catch { return ''; }
 }
 function database() {
  if (!dbPromise) dbPromise = new Promise(resolve => {
   if (!indexedDB || !viewerId) return resolve(null);
   let expired = false;
   const timer = setTimeout(() => { expired = true; resolve(null); }, 1500);
   try {
    const request = indexedDB.open(`parascene-creation-thumbnails-v1:${viewerId}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
     clearTimeout(timer);
     if (expired) request.result.close();
     else resolve(request.result);
    };
    request.onerror = request.onblocked = () => { expired = true; clearTimeout(timer); resolve(null); };
   } catch { clearTimeout(timer); resolve(null); }
  });
  return dbPromise;
 }
 async function transaction(mode, action) {
  const db = await database();
  if (!db) return null;
  return new Promise(resolve => {
   try {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    const timer = setTimeout(() => { try { tx.abort(); } catch {} resolve(null); }, 1500);
    tx.oncomplete = () => { clearTimeout(timer); resolve(request.result); };
    tx.onerror = tx.onabort = () => { clearTimeout(timer); resolve(null); };
   } catch { resolve(null); }
  });
 }
 let ready;
 function load() {
  if (!ready) ready = transaction('readonly', store => store.get('recent')).then(rows => {
   if (stopped || !Array.isArray(rows)) return;
   for (const row of rows.slice(0, LIMIT)) {
    if (!Array.isArray(row)) continue;
    const [url, blob] = row;
    if (allowed.has(url) && blob?.type?.startsWith('image/')) blobs.set(url, blob);
   }
  });
  return ready;
 }
 function persist(clear = false) {
  if (stopped && !clear) return writeQueue;
  const rows = [...blobs].filter(([url]) => allowed.has(url)).slice(0, LIMIT);
  writeQueue = writeQueue.then(() => transaction('readwrite', store =>
   clear ? store.delete('recent') : store.put(rows, 'recent')));
  return writeQueue;
 }
 function forget(url) {
  blobs.delete(url);
  const src = objectUrls.get(url);
  if (src) urlApi.revokeObjectURL(src);
  objectUrls.delete(url);
 }
 return {
  retain(urls) {
   if (stopped) return;
   allowed = new Set(urls.slice(0, LIMIT).map(canonical).filter(Boolean));
   for (const url of blobs.keys()) if (!allowed.has(url)) forget(url);
   for (const [url, request] of pending) if (!allowed.has(url)) request.controller.abort();
   void load().then(persist);
  },
  resolve(value) {
   const url = canonical(value);
   if (stopped || !allowed.has(url)) return value;
   if (objectUrls.has(url)) return objectUrls.get(url);
   if (!pending.has(url)) {
    const requestController = new AbortController();
    const abort = () => requestController.abort();
    controller.signal.addEventListener('abort', abort, { once: true });
    const promise = (async () => {
     await load();
     if (stopped || !allowed.has(url) || requestController.signal.aborted) return value;
     let blob = blobs.get(url);
     if (!blob) {
      const timer = setTimeout(() => requestController.abort(), 10_000);
      try {
       const response = await fetchImpl(url, { credentials: 'same-origin', signal: requestController.signal });
       if (!response.ok) throw new Error('Thumbnail request failed');
       blob = await response.blob();
       if (!blob.type.startsWith('image/')) throw new Error('Thumbnail is not an image');
      } finally { clearTimeout(timer); }
     }
     if (stopped || !allowed.has(url) || requestController.signal.aborted) return value;
     blobs.set(url, blob);
     const src = urlApi.createObjectURL(blob);
     objectUrls.set(url, src);
     void persist();
     return src;
    })().catch(() => value).finally(() => {
     pending.delete(url);
     controller.signal.removeEventListener('abort', abort);
    });
    pending.set(url, { promise, controller: requestController });
   }
   return pending.get(url).promise;
  },
  invalidate(value) {
   forget(canonical(value));
   return persist();
  },
  async clearCache() {
   stopped = true;
   controller.abort();
   allowed.clear();
   for (const url of [...blobs.keys()]) forget(url);
   await persist(true);
  },
  destroy() {
   stopped = true;
   controller.abort();
   for (const url of [...blobs.keys()]) forget(url);
   // Normal teardown keeps the disk cache for the next visit.
   void writeQueue.then(() => dbPromise?.then(db => db?.close()));
  },
 };
}
