import { mergeCatalogRowsById } from './catalogMerge.js';
import { FEED_BETA_DEFAULT_PARAMS } from './params.js';
import { createSeededRng } from './rng.js';
import { getFeedBetaRedis, isFeedBetaRedisConfigured } from './feedBetaRedis.js';
import { normalizeFeedBetaMediaFields } from './rowMedia.js';
import { loadNewcomerAuthorContext } from './context.js';

export const FEED_BETA_CATALOG_REDIS_KEY = 'feed-beta:catalog:v1';

/** Shared snapshot TTL — rebuild job refreshes before expiry. */
export const FEED_BETA_CATALOG_TTL_SEC = 20 * 60;

export const FEED_BETA_SNAPSHOT_RECENT_LIMIT = 400;
export const FEED_BETA_SNAPSHOT_HOT_LIMIT = 250;
export const FEED_BETA_SNAPSHOT_BACK_POOL_LIMIT = 600;

/** Live DB fallback when Redis snapshot is missing (smaller than old per-request pulls). */
export const FEED_BETA_FALLBACK_RECENT_LIMIT = 280;
export const FEED_BETA_FALLBACK_HOT_LIMIT = 180;
export const FEED_BETA_FALLBACK_BACK_LIMIT = 240;

/**
 * @param {object[]} backPool
 * @param {string} pageSeed
 * @param {number} limit
 * @returns {object[]}
 */
export function sliceBackPoolFromSeed(backPool, pageSeed, limit) {
	const pool = Array.isArray(backPool) ? backPool : [];
	const lim = Math.max(1, Number(limit) || 1);
	if (pool.length === 0) return [];
	if (pool.length <= lim) return pool.slice();
	const rng = createSeededRng(String(pageSeed ?? 'back'));
	const maxOff = pool.length - lim;
	const off = maxOff > 0 ? Math.floor(rng() * (maxOff + 1)) : 0;
	return pool.slice(off, off + lim);
}

/**
 * Build shared sitewide catalog (no viewer-specific fields). Used by rebuild job.
 *
 * @param {object} queries
 */
export async function buildFeedBetaCatalogSnapshot(queries) {
	const cat = queries?.selectFeedBetaSitewideCatalog;
	if (!cat || typeof cat.getRecent !== 'function') {
		return null;
	}

	const params = FEED_BETA_DEFAULT_PARAMS;
	const olderThan = new Date(
		Date.now() - params.backCatalogMinAgeDays * 24 * 60 * 60 * 1000
	).toISOString();

	const fetches = [
		cat.getRecent(null, { limit: FEED_BETA_SNAPSHOT_RECENT_LIMIT }),
		typeof cat.getTopEngaged === 'function'
			? cat.getTopEngaged(null, { limit: FEED_BETA_SNAPSHOT_HOT_LIMIT })
			: Promise.resolve([]),
		typeof cat.getBackCatalogSlice === 'function'
			? cat.getBackCatalogSlice(null, {
					olderThanIso: olderThan,
					offset: 0,
					limit: FEED_BETA_SNAPSHOT_BACK_POOL_LIMIT
				})
			: Promise.resolve([])
	];

	let videoHead = [];
	if (typeof queries.selectFeedItems?.getSitePublishedVideoFeedPage === 'function') {
		try {
			const vidPage = await queries.selectFeedItems.getSitePublishedVideoFeedPage(null, {
				mode: 'head',
				limit: params.slotPackVideoCap + 24
			});
			videoHead = Array.isArray(vidPage?.rows) ? vidPage.rows : [];
		} catch {
			videoHead = [];
		}
	}

	const [recent, hot, backPool] = await Promise.all(fetches);
	let publishedCount = null;
	if (typeof cat.getPublishedCount === 'function') {
		try {
			publishedCount = await cat.getPublishedCount();
		} catch {
			publishedCount = null;
		}
	}

	const mergedForNewcomer = mergeCatalogRowsById(recent, hot, backPool, videoHead);
	let newcomerAuthorIds = [];
	let newcomerHandles = [];
	try {
		const newcomer = await loadNewcomerAuthorContext(queries, mergedForNewcomer);
		newcomerAuthorIds = [...newcomer.newcomerAuthorIds];
		newcomerHandles = [...newcomer.newcomerHandles];
	} catch {
		newcomerAuthorIds = [];
		newcomerHandles = [];
	}

	return {
		version: 1,
		built_at: new Date().toISOString(),
		recent: Array.isArray(recent) ? recent : [],
		hot: Array.isArray(hot) ? hot : [],
		back_pool: Array.isArray(backPool) ? backPool : [],
		video_head: videoHead,
		published_count: publishedCount,
		newcomer_author_ids: newcomerAuthorIds,
		newcomer_handles: newcomerHandles
	};
}

/**
 * @returns {Promise<object|null>}
 */
export async function loadFeedBetaCatalogSnapshotFromRedis() {
	const r = getFeedBetaRedis();
	if (!r) return null;
	try {
		const raw = await r.get(FEED_BETA_CATALOG_REDIS_KEY);
		if (!raw || typeof raw !== 'object') return null;
		if (raw.version !== 1) return null;
		return raw;
	} catch (err) {
		console.warn('[feedBeta catalogRedis] load', err?.message || err);
		return null;
	}
}

/**
 * Drop cached sitewide catalog so the next feed pull hydrates fresh poster URLs from DB.
 */
export async function invalidateFeedBetaCatalogSnapshot() {
	const { invalidateFeedBetaCatalogMemCache } = await import('./catalogSnapshotCache.js');
	invalidateFeedBetaCatalogMemCache();
	const r = getFeedBetaRedis();
	if (!r) return false;
	try {
		await r.del(FEED_BETA_CATALOG_REDIS_KEY);
		return true;
	} catch (err) {
		console.warn('[feedBeta catalogRedis] invalidate', err?.message || err);
		return false;
	}
}

/**
 * @param {object} snapshot
 */
export async function saveFeedBetaCatalogSnapshotToRedis(snapshot) {
	const r = getFeedBetaRedis();
	if (!r || !snapshot) return false;
	try {
		await r.set(FEED_BETA_CATALOG_REDIS_KEY, snapshot, { ex: FEED_BETA_CATALOG_TTL_SEC });
		return true;
	} catch (err) {
		console.warn('[feedBeta catalogRedis] save', err?.message || err);
		return false;
	}
}

/**
 * Merge snapshot slices into one catalog for pool draws.
 *
 * @param {object|null|undefined} snapshot
 * @param {string} pageSeed
 */
export function catalogFromSnapshot(snapshot, pageSeed) {
	if (!snapshot) return [];
	const params = FEED_BETA_DEFAULT_PARAMS;
	const backSlice = sliceBackPoolFromSeed(
		snapshot.back_pool,
		pageSeed,
		params.backCatalogFetchLimit
	);
	return mergeCatalogRowsById(
		snapshot.recent,
		snapshot.hot,
		backSlice,
		snapshot.video_head
	).map(normalizeFeedBetaMediaFields);
}

export function feedBetaCatalogUsesRedisSnapshot() {
	return isFeedBetaRedisConfigured();
}
