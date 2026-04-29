const CACHE_PREFIX = "parascene";
const VERSION = (() => {
	try {
		const parsed = new URL(self.location.href);
		return parsed.searchParams.get("v") || "dev";
	} catch {
		return "dev";
	}
})();
const STATIC_CACHE = `${CACHE_PREFIX}-static-v${VERSION}`;
const IMAGE_CACHE = `${CACHE_PREFIX}-images-v${VERSION}`;
const DATA_CACHE = `${CACHE_PREFIX}-data-v${VERSION}`;
const IMAGE_MAX_ENTRIES = 300;
const DATA_MAX_ENTRIES = 120;
const STATIC_MAX_ENTRIES = 400;
const DATA_REVALIDATE_TTL_MS = 30 * 1000;
const dataRevalidateAtByKey = new Map();

const CACHEABLE_DATA_PATH_PREFIXES = [
	"/api/feed",
	"/api/explore",
	"/api/creations"
];
const CACHEABLE_STATIC_PATH_PREFIXES = [
	"/components/",
	"/icons/",
	"/pages/",
	"/audio/",
	"/shared/"
];
const CACHEABLE_STATIC_EXACT_PATHS = new Set([
	"/entry.js",
	"/global.js",
	"/global.css"
]);

function isHttpGetRequest(request) {
	return request.method === "GET" && request.url.startsWith("http");
}

function isSameOrigin(url) {
	return url.origin === self.location.origin;
}

function isImageRequest(request, url) {
	if (!isSameOrigin(url)) return false;
	if (request.destination === "image") return true;
	return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(url.pathname);
}

function isCacheableStaticRequest(request, url) {
	if (!isSameOrigin(url)) return false;
	if (url.pathname.startsWith("/api/")) return false;
	if (request.mode === "navigate" || request.destination === "document") return false;
	if (CACHEABLE_STATIC_EXACT_PATHS.has(url.pathname)) return true;
	return CACHEABLE_STATIC_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isCacheableDataRequest(request, url) {
	if (!isSameOrigin(url)) return false;
	if (request.destination && request.destination !== "") return false;
	if (!url.pathname.startsWith("/api/")) return false;
	if (/^\/api\/users\/\d+\/profile$/.test(url.pathname)) return true;
	return CACHEABLE_DATA_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

async function trimCacheEntries(cacheName, maxEntries) {
	const cache = await caches.open(cacheName);
	const keys = await cache.keys();
	if (keys.length <= maxEntries) return;
	const extra = keys.length - maxEntries;
	for (let i = 0; i < extra; i += 1) {
		await cache.delete(keys[i]);
	}
}

async function cacheFirstImages(request) {
	const cache = await caches.open(IMAGE_CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;
	const response = await fetch(request);
	const isRangeRequest = request.headers?.has("range");
	if (response && response.ok && response.status === 200 && !isRangeRequest) {
		await cache.put(request, response.clone());
		await trimCacheEntries(IMAGE_CACHE, IMAGE_MAX_ENTRIES);
	}
	return response;
}

async function cacheFirstStatic(request) {
	const cache = await caches.open(STATIC_CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;
	const response = await fetch(request);
	const isRangeRequest = request.headers?.has("range");
	if (response && response.ok && response.status === 200 && !isRangeRequest) {
		await cache.put(request, response.clone());
		await trimCacheEntries(STATIC_CACHE, STATIC_MAX_ENTRIES);
	}
	return response;
}

function buildConditionalHeaders(request, cachedResponse) {
	const headers = new Headers(request.headers || {});
	const etag = cachedResponse?.headers?.get("etag");
	const lastModified = cachedResponse?.headers?.get("last-modified");
	if (etag) headers.set("if-none-match", etag);
	if (lastModified) headers.set("if-modified-since", lastModified);
	return headers;
}

async function revalidateDataRequest(request) {
	const cache = await caches.open(DATA_CACHE);
	const cached = await cache.match(request);
	const conditionalRequest = new Request(request, {
		headers: buildConditionalHeaders(request, cached)
	});
	try {
		const network = await fetch(conditionalRequest);
		if (network.status === 304 && cached) {
			return cached;
		}
		if (network && network.ok) {
			await cache.put(request, network.clone());
			await trimCacheEntries(DATA_CACHE, DATA_MAX_ENTRIES);
		}
		return network;
	} catch {
		if (cached) return cached;
		throw new Error("network_unavailable");
	}
}

async function staleWhileRevalidateData(request) {
	const cache = await caches.open(DATA_CACHE);
	const cached = await cache.match(request);
	if (cached) {
		const key = request.url;
		const now = Date.now();
		const nextAllowedAt = dataRevalidateAtByKey.get(key) || 0;
		if (now >= nextAllowedAt) {
			dataRevalidateAtByKey.set(key, now + DATA_REVALIDATE_TTL_MS);
			void revalidateDataRequest(request);
		}
		return cached;
	}
	return revalidateDataRequest(request);
}

async function networkFirstDocument(request) {
	const cache = await caches.open(STATIC_CACHE);
	try {
		const response = await fetch(request);
		if (response && response.ok) await cache.put(request, response.clone());
		return response;
	} catch {
		const cached = await cache.match(request);
		if (cached) return cached;
		throw new Error("document_unavailable");
	}
}

async function deleteMatchingRequests(cacheName, predicate) {
	const cache = await caches.open(cacheName);
	const keys = await cache.keys();
	await Promise.all(
		keys
			.filter((req) => predicate(req))
			.map((req) => cache.delete(req))
	);
}

async function invalidateByMessage(msg) {
	if (!msg || typeof msg !== "object") return;
	const type = String(msg.type || "");
	if (type !== "PRSN_SW_INVALIDATE") return;
	if (msg.all === true) {
		await caches.delete(DATA_CACHE);
		await caches.delete(IMAGE_CACHE);
		dataRevalidateAtByKey.clear();
		return;
	}
	const tags = Array.isArray(msg.tags) ? msg.tags.map((x) => String(x)) : [];
	const urls = Array.isArray(msg.urls) ? msg.urls.map((x) => String(x)) : [];
	const dataPrefixes = new Set();
	for (const tag of tags) {
		if (tag === "feed") dataPrefixes.add("/api/feed");
		if (tag === "explore") dataPrefixes.add("/api/explore");
		if (tag === "creations") dataPrefixes.add("/api/creations");
		if (tag === "userProfiles") dataPrefixes.add("/api/users/");
	}
	for (const url of urls) {
		try {
			const parsed = new URL(url, self.location.origin);
			if (parsed.origin === self.location.origin) dataPrefixes.add(parsed.pathname);
		} catch {
			// Ignore invalid urls.
		}
	}
	if (tags.includes("images")) {
		await caches.delete(IMAGE_CACHE);
	}
	if (dataPrefixes.size > 0) {
		for (const key of [...dataRevalidateAtByKey.keys()]) {
			try {
				const parsed = new URL(key);
				if ([...dataPrefixes].some((prefix) => parsed.pathname.startsWith(prefix))) {
					dataRevalidateAtByKey.delete(key);
				}
			} catch {
				// ignore malformed keys
			}
		}
		await deleteMatchingRequests(DATA_CACHE, (req) => {
			try {
				const parsed = new URL(req.url);
				return [...dataPrefixes].some((prefix) => parsed.pathname.startsWith(prefix));
			} catch {
				return false;
			}
		});
	}
}

self.addEventListener("install", (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		const expectedPrefix = `${CACHE_PREFIX}-`;
		const expectedVersionTag = `-v${VERSION}`;
		const keys = await caches.keys();
		await Promise.all(
			keys
				.filter((name) => name.startsWith(expectedPrefix) && !name.endsWith(expectedVersionTag))
				.map((name) => caches.delete(name))
		);
		await self.clients.claim();
	})());
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (!isHttpGetRequest(request)) return;
	const url = new URL(request.url);
	if (!isSameOrigin(url)) return;

	if (request.mode === "navigate" || request.destination === "document") {
		event.respondWith(networkFirstDocument(request));
		return;
	}
	if (isImageRequest(request, url)) {
		event.respondWith(cacheFirstImages(request));
		return;
	}
	if (isCacheableStaticRequest(request, url)) {
		event.respondWith(cacheFirstStatic(request));
		return;
	}
	if (isCacheableDataRequest(request, url)) {
		event.respondWith(staleWhileRevalidateData(request));
		return;
	}
});

self.addEventListener("message", (event) => {
	event.waitUntil(invalidateByMessage(event.data));
});
