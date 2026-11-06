import { loadFeedBetaCatalogSnapshotFromRedis } from './catalogSnapshot.js';

/** Avoid repeated Upstash round-trips within a warm process. */
const MEM_TTL_MS = 45_000;

/** @type {{ at: number, snapshot: object|null }} */
let mem = { at: 0, snapshot: null };

export function invalidateFeedBetaCatalogMemCache() {
	mem = { at: 0, snapshot: null };
}

export function isFeedBetaCatalogMemCacheFresh() {
	return Boolean(mem.snapshot && Date.now() - mem.at < MEM_TTL_MS);
}

/** @param {object|null|undefined} snapshot */
export function primeFeedBetaCatalogMemCache(snapshot) {
	if (!snapshot || typeof snapshot !== 'object') return;
	mem = { at: Date.now(), snapshot };
}

/** @deprecated test alias */
export const resetFeedBetaCatalogMemCacheForTests = invalidateFeedBetaCatalogMemCache;

/**
 * @returns {Promise<object|null>}
 */
export async function loadFeedBetaCatalogSnapshotCached() {
	const now = Date.now();
	if (mem.snapshot && now - mem.at < MEM_TTL_MS) {
		return mem.snapshot;
	}
	const snapshot = await loadFeedBetaCatalogSnapshotFromRedis();
	if (snapshot) {
		mem = { at: now, snapshot };
	}
	return snapshot;
}
