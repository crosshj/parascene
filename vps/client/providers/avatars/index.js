const DB_NAME = 'parascene-avatar-blobs';
const DB_VERSION = 1;
const STORE_NAME = 'avatars';
const MAX_ENTRIES = 500;
const AVATAR_PATH = /\/api\/images\/generic\/profile\/\d+\/avatar_[a-z0-9_-]+\.webp$/i;

function canonicalUrl(value) {
	const raw = String(value ?? '').trim();
	if (!raw || /^(?:null|undefined|false)$/i.test(raw) || /^\/(?:null|undefined)$/i.test(raw)) return '';
	try {
		const url = new URL(raw, window.location.href);
		if (/^\/(?:null|undefined)$/i.test(url.pathname)) return '';
		return url.href;
	} catch {
		return '';
	}
}

function canCacheAvatar(url) {
	try {
		const parsed = new URL(url);
		return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && AVATAR_PATH.test(parsed.pathname);
	} catch {
		return false;
	}
}

function openDatabase() {
	if (!window.indexedDB) return Promise.resolve(null);
	return new Promise((resolve, reject) => {
		let expired = false;
		const timer = setTimeout(() => { expired = true; resolve(null); }, 1500);
		const request = window.indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'url' });
		};
		request.onsuccess = () => {
			clearTimeout(timer);
			if (expired) request.result.close();
			else resolve(request.result);
		};
		request.onerror = () => { clearTimeout(timer); reject(request.error || new Error('Could not open avatar cache')); };
		request.onblocked = () => { expired = true; clearTimeout(timer); resolve(null); };
	});
}

function transactionRequest(db, mode, action) {
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE_NAME, mode);
		const store = transaction.objectStore(STORE_NAME);
		let request;
		try { request = action(store); } catch (error) { reject(error); return; }
		transaction.oncomplete = () => resolve(request.result);
		transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error || new Error('Avatar cache request failed'));
	});
}

function trimCache(db) {
	return new Promise((resolve) => {
		try {
			const transaction = db.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const rows = [];
			store.openCursor().onsuccess = (event) => {
				const cursor = event.target.result;
				if (cursor) {
					rows.push({ key: cursor.primaryKey, usedAt: Number(cursor.value.usedAt) || 0 });
					cursor.continue();
					return;
				}
				rows.sort((a, b) => b.usedAt - a.usedAt);
				for (const row of rows.slice(MAX_ENTRIES)) store.delete(row.key);
			};
			transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
		} catch { resolve(); }
	});
}

/** Persistent public avatar blobs with a bounded LRU and app-lifetime object URLs. */
export function createAvatarsProvider({ fetchImpl = (...args) => fetch(...args) } = {}) {
	let dbPromise = null;
	let observer = null;
	const objectUrls = new Map();
	const retiredObjectUrls = new Set();
	const pending = new Map();
	const uncachedUrls = new Set();
	let destroyed = false;

	function database() {
		if (!dbPromise) dbPromise = openDatabase().catch(() => null);
		return dbPromise;
	}

	async function readBlob(url) {
		const db = await database();
		if (!db) return null;
		const row = await transactionRequest(db, 'readonly', (store) => store.get(url)).catch(() => null);
		if (!row?.blob) return null;
		void transactionRequest(db, 'readwrite', (store) => store.put({ ...row, usedAt: Date.now() })).catch(() => {});
		return row.blob;
	}

	async function deleteBlob(url) {
		const db = await database();
		if (db) await transactionRequest(db, 'readwrite', (store) => store.delete(url)).catch(() => {});
		const objectUrl = objectUrls.get(url);
		if (objectUrl) {
			objectUrls.delete(url);
			retiredObjectUrls.add(objectUrl);
		}
	}

	async function fetchAndStore(url) {
		const cached = await readBlob(url);
		if (cached) return cached;
		const response = await fetchImpl(url, { mode: 'cors', credentials: 'same-origin', cache: 'force-cache' });
		if (!response.ok) throw new Error(`Avatar request failed (${response.status})`);
		const blob = await response.blob();
		if (!blob.type.startsWith('image/')) throw new Error('Avatar response was not an image');
		const db = await database();
		if (db) {
			await transactionRequest(db, 'readwrite', (store) => store.put({ url, blob, usedAt: Date.now() })).catch(() => {});
			void trimCache(db);
		}
		return blob;
	}

	async function resolve(url) {
		if (!canCacheAvatar(url)) return url;
		if (destroyed || uncachedUrls.has(url)) return url;
		if (objectUrls.has(url)) return objectUrls.get(url);
		if (!pending.has(url)) {
			pending.set(url, fetchAndStore(url)
				.then((blob) => {
					if (destroyed) return url;
					const objectUrl = URL.createObjectURL(blob);
					objectUrls.set(url, objectUrl);
					return objectUrl;
				})
				.catch(() => {
					// A CDN without blob-fetch CORS can still display a normal image.
					// Avoid retrying the same failed fetch for every avatar mount.
					uncachedUrls.add(url);
					return url;
				})
				.finally(() => pending.delete(url)));
		}
		return pending.get(url);
	}

	function hydrate(image) {
		if (!(image instanceof HTMLImageElement)) return;
		const url = canonicalUrl(image.dataset.avatarSrc);
		if (!url) {
			image.removeAttribute('src');
			image.hidden = true;
			image.classList.add('is-avatar-unresolved');
			delete image.dataset.avatarResolved;
			delete image.dataset.avatarBlobSource;
			return;
		}
		image.hidden = false;
		if (image.dataset.avatarResolved === url && image.getAttribute('src')) return;
		image.classList.remove('is-avatar-unresolved');
		image.dataset.avatarResolved = url;
		image.onerror = () => {
			if (image.dataset.avatarResolved !== url) return;
			const retryingBlob = image.dataset.avatarBlobSource === url && image.src.startsWith('blob:');
			if (retryingBlob) {
				image.dataset.avatarBlobSource = '';
				uncachedUrls.add(url);
				void deleteBlob(url);
				image.src = url;
				return;
			}
			image.classList.add('is-avatar-unresolved');
		};
		if (!canCacheAvatar(url)) {
			image.src = url;
			return;
		}
		// Reuse an existing object URL synchronously; otherwise read IndexedDB first.
		if (objectUrls.has(url)) {
			image.dataset.avatarBlobSource = url;
			image.src = objectUrls.get(url);
			return;
		}
		void resolve(url).then((src) => {
			if (!destroyed && image.isConnected && image.dataset.avatarSrc && canonicalUrl(image.dataset.avatarSrc) === url) {
				image.dataset.avatarBlobSource = src.startsWith('blob:') ? url : '';
				image.src = src;
			}
		}).catch(() => {
			if (image.isConnected && canonicalUrl(image.dataset.avatarSrc) === url) image.src = url;
		});
	}

	function scan(node) {
		if (node instanceof HTMLImageElement && node.hasAttribute('data-avatar-src')) hydrate(node);
		if (node?.querySelectorAll) node.querySelectorAll('img[data-avatar-src]').forEach(hydrate);
	}

	return {
		start(root = document.documentElement) {
			if (observer || !root) return;
			observer = new MutationObserver((records) => {
				for (const record of records) {
					if (record.type === 'attributes') scan(record.target);
					else record.addedNodes.forEach(scan);
				}
			});
			observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-avatar-src'] });
			scan(root);
		},
		async preload(urls = []) {
			await Promise.allSettled(urls.map((value) => {
				const url = canonicalUrl(value);
				return canCacheAvatar(url) ? resolve(url) : Promise.resolve(null);
			}));
		},
		syncExternalCache() {},
		clearCache() {},
		destroy() {
			destroyed = true;
			observer?.disconnect();
			observer = null;
			for (const value of objectUrls.values()) URL.revokeObjectURL(value);
			for (const value of retiredObjectUrls) URL.revokeObjectURL(value);
			objectUrls.clear();
			retiredObjectUrls.clear();
			pending.clear();
			dbPromise?.then((db) => db?.close());
			dbPromise = null;
		},
	};
}
