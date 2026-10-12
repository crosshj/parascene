import { loadFeedCatalogSnapshotFromRedis } from "./catalogSnapshot.js";

/** Avoid repeated Upstash round-trips within a warm process. */
const MEM_TTL_MS = 45_000;

/** @type {{ at: number, snapshot: object|null }} */
let mem = { at: 0, snapshot: null };

export function invalidateFeedCatalogMemCache() {
	mem = { at: 0, snapshot: null };
}

export function isFeedCatalogMemCacheFresh() {
	return Boolean(mem.snapshot && Date.now() - mem.at < MEM_TTL_MS);
}

/** @param {object|null|undefined} snapshot */
export function primeFeedCatalogMemCache(snapshot) {
	if (!snapshot || typeof snapshot !== 'object') return;
	mem = { at: Date.now(), snapshot };
}

/** @deprecated test alias */
export const resetFeedCatalogMemCacheForTests = invalidateFeedCatalogMemCache;

/**
 * @returns {Promise<object|null>}
 */
export async function loadFeedCatalogSnapshotCached() {
	const now = Date.now();
	if (mem.snapshot && now - mem.at < MEM_TTL_MS) {
		return mem.snapshot;
	}
	const snapshot = await loadFeedCatalogSnapshotFromRedis();
	if (snapshot) {
		mem = { at: now, snapshot };
	}
	return snapshot;
}
