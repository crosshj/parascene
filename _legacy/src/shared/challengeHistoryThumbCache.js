/**
 * Persisted resolved URLs for challenge history / organize card thumbs.
 * Paint instantly from storage, then refresh via creation API.
 */

export const CHALLENGE_HISTORY_THUMB_CACHE_KEY = 'prsn-challenge-history-thumbs-v1';

/** Prefer a background refetch after this age; stale URLs still paint instantly. */
export const CHALLENGE_HISTORY_THUMB_STALE_MS = 5 * 60 * 1000;

const MAX_ENTRIES = 200;

/**
 * @returns {Record<string, { url: string, cachedAt: number }>}
 */
function readAll() {
	if (typeof localStorage === 'undefined') return {};
	try {
		const raw = localStorage.getItem(CHALLENGE_HISTORY_THUMB_CACHE_KEY);
		if (!raw) return {};
		const o = JSON.parse(raw);
		if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
		/** @type {Record<string, { url: string, cachedAt: number }>} */
		const out = {};
		for (const [k, v] of Object.entries(o)) {
			if (!k || !v || typeof v !== 'object') continue;
			const url = typeof v.url === 'string' ? v.url.trim() : '';
			const cachedAt = Number(v.cachedAt);
			if (!url || !Number.isFinite(cachedAt)) continue;
			out[k] = { url, cachedAt };
		}
		return out;
	} catch {
		return {};
	}
}

/**
 * @param {Record<string, { url: string, cachedAt: number }>} map
 */
function writeAll(map) {
	if (typeof localStorage === 'undefined') return;
	try {
		const entries = Object.entries(map || {});
		entries.sort((a, b) => (b[1]?.cachedAt || 0) - (a[1]?.cachedAt || 0));
		const trimmed = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
		localStorage.setItem(CHALLENGE_HISTORY_THUMB_CACHE_KEY, JSON.stringify(trimmed));
	} catch {
		// quota / private mode
	}
}

/**
 * Stable key for a pending thumb wrap (ref + optional challenge id).
 * @param {string} ref
 * @param {string} [challengeId]
 */
export function challengeHistoryThumbCacheKey(ref, challengeId) {
	const r = typeof ref === 'string' ? ref.trim() : '';
	const c = typeof challengeId === 'string' ? challengeId.trim() : '';
	return c ? `${r}\0c:${c}` : r;
}

/**
 * @param {string} key
 * @returns {{ url: string, cachedAt: number } | null}
 */
export function readChallengeHistoryThumbCache(key) {
	if (!key) return null;
	const all = readAll();
	return all[key] || null;
}

/**
 * @param {string} key
 * @param {string} url
 */
export function writeChallengeHistoryThumbCache(key, url) {
	const k = typeof key === 'string' ? key.trim() : '';
	const u = typeof url === 'string' ? url.trim() : '';
	if (!k || !u) return;
	const all = readAll();
	all[k] = { url: u, cachedAt: Date.now() };
	writeAll(all);
}

export function clearChallengeHistoryThumbCache() {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(CHALLENGE_HISTORY_THUMB_CACHE_KEY);
	} catch {
		// ignore
	}
}

export function isChallengeHistoryThumbCacheStale(cachedAt) {
	return Date.now() - Number(cachedAt || 0) > CHALLENGE_HISTORY_THUMB_STALE_MS;
}
