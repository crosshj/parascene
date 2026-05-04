/**
 * Persisted cache for GET /api/chat/threads (per browser profile).
 * Used for cache-then-network-if-stale: paint from storage immediately, fetch only when missing or stale.
 */

export const CHAT_THREADS_CACHE_KEY = 'prsn-chat-threads-v1';

/** After this age, a background refetch is required (initial visit still paints stale list instantly). */
export const CHAT_THREADS_STALE_MS = 60 * 1000;

/**
 * @returns {{ viewerId: number, threads: unknown[], cachedAt: number, viewerIsAdmin?: boolean, viewerIsFounder?: boolean } | null}
 */
export function readCachedChatThreads() {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(CHAT_THREADS_CACHE_KEY);
		if (!raw) return null;
		const o = JSON.parse(raw);
		if (!o || typeof o.cachedAt !== 'number') return null;
		if (!Array.isArray(o.threads)) return null;
		const viewerId = o.viewerId != null ? Number(o.viewerId) : null;
		if (viewerId == null || !Number.isFinite(viewerId)) return null;
		const viewerIsAdmin = o.viewerIsAdmin === true;
		const viewerIsFounder = o.viewerIsFounder === true;
		return { viewerId, threads: o.threads, cachedAt: o.cachedAt, viewerIsAdmin, viewerIsFounder };
	} catch {
		return null;
	}
}

/**
 * @param {number} viewerId
 * @param {unknown[]} threads
 * @param {{ viewerIsAdmin?: boolean, viewerIsFounder?: boolean }} [meta]
 */
export function writeCachedChatThreads(viewerId, threads, meta = {}) {
	if (typeof localStorage === 'undefined') return;
	try {
		const payload = {
			viewerId: Number(viewerId),
			threads,
			cachedAt: Date.now()
		};
		if (meta.viewerIsAdmin === true) {
			payload.viewerIsAdmin = true;
		}
		if (meta.viewerIsFounder === true) {
			payload.viewerIsFounder = true;
		}
		localStorage.setItem(CHAT_THREADS_CACHE_KEY, JSON.stringify(payload));
	} catch {
		// quota / private mode
	}
}

export function clearCachedChatThreads() {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(CHAT_THREADS_CACHE_KEY);
	} catch {
		// ignore
	}
}

export function isChatThreadsCacheStale(cachedAt) {
	return Date.now() - cachedAt > CHAT_THREADS_STALE_MS;
}
