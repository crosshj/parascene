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
/** Persistent bucket for all `/api/images/*` (survives SW `?v=` updates). LRU + last-access metadata. */
const IMAGE_CACHE = `${CACHE_PREFIX}-images`;
/**
 * Versioned bucket for bundled public image URLs (`/images/`, image-like `/icons/*`).
 * Resets when app/SW asset `?v=` changes (same lifecycle as STATIC_CACHE).
 * Other public modules (JS/CSS under `/components/`, `/pages/`, …) use STATIC_CACHE, not this.
 */
const PUBLIC_IMAGE_CACHE = `${CACHE_PREFIX}-public-images-v${VERSION}`;
const DATA_CACHE = `${CACHE_PREFIX}-data-v${VERSION}`;
const META_CACHE = `${CACHE_PREFIX}-meta`;
const IMAGE_MAX_ENTRIES = 300;
const PUBLIC_IMAGE_MAX_ENTRIES = 120;
const DATA_MAX_ENTRIES = 120;
const STATIC_MAX_ENTRIES = 400;
const IMAGE_MANAGED_IDLE_MAX_DAYS = 30;
const IMAGE_LAST_ACCESSED_MAX_AGE_MS = IMAGE_MANAGED_IDLE_MAX_DAYS * 24 * 60 * 60 * 1000;
const IMAGE_TRIM_THROTTLE_MS = 60 * 1000;
const DATA_REVALIDATE_TTL_MS = 30 * 1000;
const FEED_VERSION_CHECK_TTL_MS = 15 * 1000;
const FEED_VERSION_CACHE_URL = "/__sw/meta/version_feed";
const dataRevalidateAtByKey = new Map();
let feedVersionCheckInFlight = null;
let nextFeedVersionCheckAt = 0;
let nextImageTrimAt = 0;

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

function isApiImagesPath(pathname) {
	return String(pathname || "").startsWith("/api/images/");
}

/** Files shipped under public/ for URLs like /images/servers/*.png — not user-generated API images. */
function isPublicBundledImagePath(pathname) {
	const p = String(pathname || "");
	if (p.startsWith("/images/")) return true;
	if (p.startsWith("/icons/") && /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(p)) return true;
	return false;
}

function isCacheableStaticRequest(request, url) {
	if (!isSameOrigin(url)) return false;
	if (url.pathname.startsWith("/api/")) return false;
	if (request.mode === "navigate" || request.destination === "document") return false;
	if (CACHEABLE_STATIC_EXACT_PATHS.has(url.pathname)) return true;
	return CACHEABLE_STATIC_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

/** Path matches our static public buckets (`/shared/`, `/components/`, … or exact `/entry.js`, …). */
function isPublicStaticAssetPath(pathname) {
	if (CACHEABLE_STATIC_EXACT_PATHS.has(pathname)) return true;
	return CACHEABLE_STATIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Plain ESM often static-imports `./foo.js` without `?v=`; that URL can desync from `foo.js?v=asset`.
 * Append `v` from this SW’s registration URL so fetch/cache keys align with dynamic imports.
 */
function requestWithAssetVersionIfNeeded(request) {
	try {
		const url = new URL(request.url);
		if (!isSameOrigin(url)) return request;
		if (!isHttpGetRequest(request)) return request;
		if (!isPublicStaticAssetPath(url.pathname)) return request;
		if (!/\.(js|mjs|css)$/i.test(url.pathname)) return request;
		if (url.searchParams.has("v")) return request;

		url.searchParams.set("v", VERSION);
		return new Request(url.href, {
			method: request.method,
			headers: request.headers,
			mode: request.mode,
			credentials: request.credentials,
			cache: request.cache,
			redirect: request.redirect,
			referrer: request.referrer,
			referrerPolicy: request.referrerPolicy,
			integrity: request.integrity
		});
	} catch {
		return request;
	}
}

function isCacheableDataRequest(request, url) {
	if (!isSameOrigin(url)) return false;
	if (request.destination && request.destination !== "") return false;
	if (!url.pathname.startsWith("/api/")) return false;
	if (url.pathname === "/api/feed/version") return false;
	if (/^\/api\/users\/\d+\/profile$/.test(url.pathname)) return true;
	return CACHEABLE_DATA_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isFeedDataRequest(url) {
	return url.pathname.startsWith("/api/feed") && url.pathname !== "/api/feed/version";
}

function parseVersionNumber(raw) {
	const n = Number.parseInt(String(raw ?? ""), 10);
	if (!Number.isFinite(n) || n < 0) return null;
	return n;
}

function imageAccessMetaUrl(requestUrl) {
	return `/__sw/meta/image-access/${encodeURIComponent(String(requestUrl || ""))}`;
}

async function getImageLastAccessedMs(requestUrl) {
	const cache = await caches.open(META_CACHE);
	const req = new Request(imageAccessMetaUrl(requestUrl));
	const cached = await cache.match(req);
	if (!cached) return null;
	try {
		const data = await cached.json();
		const ms = Number(data?.last_accessed_ms);
		return Number.isFinite(ms) && ms > 0 ? ms : null;
	} catch {
		return null;
	}
}

async function touchImageLastAccessed(requestUrl, nowMs = Date.now()) {
	const cache = await caches.open(META_CACHE);
	const req = new Request(imageAccessMetaUrl(requestUrl));
	const payload = JSON.stringify({ last_accessed_ms: nowMs });
	await cache.put(req, new Response(payload, { headers: { "content-type": "application/json" } }));
}

async function deleteImageLastAccessed(requestUrl) {
	const cache = await caches.open(META_CACHE);
	await cache.delete(new Request(imageAccessMetaUrl(requestUrl)));
}

async function clearImageAccessMetadata() {
	const cache = await caches.open(META_CACHE);
	const keys = await cache.keys();
	await Promise.all(
		keys
			.filter((req) => req.url.includes("/__sw/meta/image-access/"))
			.map((req) => cache.delete(req))
	);
}

async function trimManagedImageCache() {
	const now = Date.now();
	if (now < nextImageTrimAt) return;
	nextImageTrimAt = now + IMAGE_TRIM_THROTTLE_MS;

	const cache = await caches.open(IMAGE_CACHE);
	const keys = await cache.keys();
	const managedEntries = [];

	for (const req of keys) {
		try {
			const parsed = new URL(req.url);
			if (!isApiImagesPath(parsed.pathname)) continue;
			const lastAccessed = (await getImageLastAccessedMs(req.url)) ?? 0;
			managedEntries.push({ request: req, requestUrl: req.url, lastAccessed });
		} catch {
			// ignore malformed URL entries
		}
	}

	// Expire entries that have been idle longer than the configured max age.
	const idleCutoff = now - IMAGE_LAST_ACCESSED_MAX_AGE_MS;
	for (const entry of managedEntries) {
		if (entry.lastAccessed > 0 && entry.lastAccessed >= idleCutoff) continue;
		await cache.delete(entry.request);
		await deleteImageLastAccessed(entry.requestUrl);
	}

	const remainingKeys = await cache.keys();
	if (remainingKeys.length <= IMAGE_MAX_ENTRIES) return;
	const overBy = remainingKeys.length - IMAGE_MAX_ENTRIES;
	if (overBy <= 0) return;

	const remainingManaged = [];
	for (const req of remainingKeys) {
		try {
			const parsed = new URL(req.url);
			if (!isApiImagesPath(parsed.pathname)) continue;
			const lastAccessed = (await getImageLastAccessedMs(req.url)) ?? 0;
			remainingManaged.push({ request: req, requestUrl: req.url, lastAccessed });
		} catch {
			// ignore malformed URL entries
		}
	}

	remainingManaged.sort((a, b) => a.lastAccessed - b.lastAccessed);
	for (let i = 0; i < Math.min(overBy, remainingManaged.length); i += 1) {
		const victim = remainingManaged[i];
		await cache.delete(victim.request);
		await deleteImageLastAccessed(victim.requestUrl);
	}
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

async function getStoredFeedVersion() {
	const cache = await caches.open(META_CACHE);
	const req = new Request(FEED_VERSION_CACHE_URL);
	const cached = await cache.match(req);
	if (!cached) return null;
	try {
		const data = await cached.json();
		return parseVersionNumber(data?.version);
	} catch {
		return null;
	}
}

async function setStoredFeedVersion(version) {
	const normalized = parseVersionNumber(version);
	if (normalized == null) return;
	const cache = await caches.open(META_CACHE);
	const req = new Request(FEED_VERSION_CACHE_URL);
	const payload = JSON.stringify({ version: normalized, updated_at: Date.now() });
	await cache.put(req, new Response(payload, { headers: { "content-type": "application/json" } }));
}

async function fetchFeedVersion() {
	try {
		const response = await fetch("/api/feed/version", {
			method: "GET",
			credentials: "include",
			headers: { Accept: "application/json" }
		});
		if (response.status === 401 || response.status === 403) return null;
		if (!response.ok) return null;
		const data = await response.json();
		return parseVersionNumber(data?.version);
	} catch {
		return null;
	}
}

async function checkFeedVersionAndInvalidateIfNeeded() {
	const now = Date.now();
	if (now < nextFeedVersionCheckAt) return;
	if (feedVersionCheckInFlight) {
		await feedVersionCheckInFlight;
		return;
	}
	feedVersionCheckInFlight = (async () => {
		const latest = await fetchFeedVersion();
		nextFeedVersionCheckAt = Date.now() + FEED_VERSION_CHECK_TTL_MS;
		if (latest == null) return;
		const stored = await getStoredFeedVersion();
		if (stored == null) {
			await setStoredFeedVersion(latest);
			return;
		}
		if (latest !== stored) {
			await invalidateByMessage({ type: "PRSN_SW_INVALIDATE", tags: ["feed"] });
			await setStoredFeedVersion(latest);
		}
	})();
	try {
		await feedVersionCheckInFlight;
	} finally {
		feedVersionCheckInFlight = null;
	}
}

function shouldPersistImageResponse(response, url) {
	if (!response || !response.ok || response.status !== 200) return false;
	// Avoid caching redirect chains as the final URL (e.g. /images/x.png → HTML welcome page).
	if (response.redirected) return false;
	const ct = (response.headers.get("content-type") || "").toLowerCase();
	const pathname = url.pathname || "";
	if (ct.includes("text/html") || ct.includes("application/json")) return false;
	if (pathname.startsWith("/api/images/")) {
		return true;
	}
	if (ct.startsWith("image/")) return true;
	// Some hosts omit Content-Type; only persist extension-named URLs when not obviously text.
	if (/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(pathname)) {
		return !ct.includes("text/");
	}
	return false;
}

/** Cache-first in persistent IMAGE_CACHE: `/api/images/*` (tracked) and incidental same-origin images. */
async function cacheFirstPersistentImages(request) {
	const cache = await caches.open(IMAGE_CACHE);
	let parsedUrl = null;
	try {
		parsedUrl = new URL(request.url);
	} catch {
		parsedUrl = null;
	}
	const pathname = parsedUrl?.pathname || "";
	const trackAccess = isApiImagesPath(pathname);
	const cached = await cache.match(request);
	if (cached) {
		const badCt = (cached.headers.get("content-type") || "").toLowerCase();
		if (badCt.includes("text/html") || badCt.includes("application/json")) {
			await cache.delete(request);
		} else {
			if (trackAccess) {
				await touchImageLastAccessed(request.url);
				await trimManagedImageCache();
			}
			return cached;
		}
	}
	const response = await fetch(request);
	const isRangeRequest = request.headers?.has("range");
	if (
		response &&
		response.ok &&
		response.status === 200 &&
		!isRangeRequest &&
		parsedUrl &&
		shouldPersistImageResponse(response, parsedUrl)
	) {
		await cache.put(request, response.clone());
		if (trackAccess) {
			await touchImageLastAccessed(request.url);
			await trimManagedImageCache();
		} else {
			await trimCacheEntries(IMAGE_CACHE, IMAGE_MAX_ENTRIES);
		}
	}
	return response;
}

async function cacheFirstPublicImages(request) {
	let parsedUrl = null;
	try {
		parsedUrl = new URL(request.url);
	} catch {
		parsedUrl = null;
	}
	const pathname = parsedUrl?.pathname || "";
	const cache = await caches.open(PUBLIC_IMAGE_CACHE);
	const legacy = await caches.open(IMAGE_CACHE);
	await legacy.delete(request);

	const cached = await cache.match(request);
	if (cached) {
		const badCt = (cached.headers.get("content-type") || "").toLowerCase();
		if (badCt.includes("text/html") || badCt.includes("application/json")) {
			await cache.delete(request);
		} else {
			return cached;
		}
	}
	const response = await fetch(request);
	const isRangeRequest = request.headers?.has("range");
	if (
		response &&
		response.ok &&
		response.status === 200 &&
		!isRangeRequest &&
		parsedUrl &&
		shouldPersistImageResponse(response, parsedUrl)
	) {
		await cache.put(request, response.clone());
		await trimCacheEntries(PUBLIC_IMAGE_CACHE, PUBLIC_IMAGE_MAX_ENTRIES);
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
		await caches.delete(PUBLIC_IMAGE_CACHE);
		await clearImageAccessMetadata();
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
	// API-backed images only; bundled `/images/` stay on versioned PUBLIC_IMAGE_CACHE until next SW ?v=.
	if (tags.includes("images")) {
		await caches.delete(IMAGE_CACHE);
		await clearImageAccessMetadata();
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
		const persistentCaches = new Set([IMAGE_CACHE, META_CACHE]);
		const keys = await caches.keys();
		await Promise.all(
			keys
				.filter(
					(name) =>
						name.startsWith(expectedPrefix) &&
						!name.endsWith(expectedVersionTag) &&
						!persistentCaches.has(name)
				)
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
		event.respondWith(
			isPublicBundledImagePath(url.pathname)
				? cacheFirstPublicImages(request)
				: cacheFirstPersistentImages(request)
		);
		return;
	}
	if (isCacheableStaticRequest(request, url)) {
		event.respondWith(cacheFirstStatic(requestWithAssetVersionIfNeeded(request)));
		return;
	}
	if (isCacheableDataRequest(request, url)) {
		event.respondWith((async () => {
			if (isFeedDataRequest(url)) {
				await checkFeedVersionAndInvalidateIfNeeded();
			}
			return staleWhileRevalidateData(request);
		})());
		return;
	}
});

self.addEventListener("message", (event) => {
	event.waitUntil(invalidateByMessage(event.data));
});
