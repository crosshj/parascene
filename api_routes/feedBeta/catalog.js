import { FEED_BETA_DEFAULT_PARAMS } from './params.js';
import { createSeededRng } from './rng.js';
import { mergeCatalogRowsById } from './catalogMerge.js';
import {
	catalogFromSnapshot,
	FEED_BETA_FALLBACK_BACK_LIMIT,
	FEED_BETA_FALLBACK_HOT_LIMIT,
	FEED_BETA_FALLBACK_RECENT_LIMIT
} from './catalogSnapshot.js';
import { loadFeedBetaCatalogSnapshotCached } from './catalogSnapshotCache.js';
import { normalizeFeedBetaMediaFields, feedRowCreationIdKey, feedRowIsVideoThread } from './rowMedia.js';
import { isFeedBetaRowExcludedFromPools } from './seen.js';

export { mergeCatalogRowsById } from './catalogMerge.js';

/**
 * @param {object} queries
 * @param {number} userId
 * @returns {Promise<Set<string>>}
 */
export async function loadViewerLikedCreationIdSetForUser(queries, userId) {
	const load = queries?.selectViewerLikedCreationIdsByUser?.all;
	if (typeof load !== 'function') return new Set();
	try {
		const liked = await load(userId, { limit: 2000 });
		return new Set((Array.isArray(liked) ? liked : []).map((id) => String(id)));
	} catch {
		return new Set();
	}
}

/**
 * @param {object} queries
 * @param {number} userId
 * @param {number[]} creationIds
 * @returns {Promise<Set<string>>}
 */
export async function loadViewerLikedCreationIdSet(queries, userId, creationIds) {
	const batch = queries?.selectViewerLikedCreationIds?.all;
	if (typeof batch !== 'function') return new Set();
	const ids = (Array.isArray(creationIds) ? creationIds : [])
		.map((id) => Number(id))
		.filter((id) => Number.isFinite(id) && id > 0);
	if (ids.length === 0) return new Set();
	try {
		const liked = await batch(userId, ids);
		return new Set((Array.isArray(liked) ? liked : []).map((id) => String(id)));
	} catch {
		return new Set();
	}
}

/**
 * Stamp `viewer_liked` from a preloaded set (no DB).
 *
 * @param {object[]} catalog
 * @param {Set<string>} liked
 */
export function applyViewerLikedFromSet(catalog, liked) {
	if (!Array.isArray(catalog) || catalog.length === 0) return catalog;
	if (!(liked instanceof Set) || liked.size === 0) {
		return catalog.map((row) => ({ ...row, viewer_liked: false }));
	}
	return catalog.map((row) => {
		const key = row?.created_image_id != null ? String(row.created_image_id) : '';
		return {
			...row,
			viewer_liked: key ? liked.has(key) : false
		};
	});
}

/**
 * One likes-table query for pool exclusion (`viewer_liked`).
 *
 * @param {object} queries
 * @param {number} userId
 * @param {object[]} catalog
 */
export async function applyViewerLikedToCatalog(queries, userId, catalog) {
	if (!Array.isArray(catalog) || catalog.length === 0) return catalog;
	const byUser = queries?.selectViewerLikedCreationIdsByUser?.all;
	const byIds = queries?.selectViewerLikedCreationIds?.all;
	if (typeof byUser !== 'function' && typeof byIds !== 'function') return catalog;
	const liked =
		typeof byUser === 'function'
			? await loadViewerLikedCreationIdSetForUser(queries, userId)
			: await loadViewerLikedCreationIdSet(
					queries,
					userId,
					catalog.map((row) => row?.created_image_id).filter((id) => id != null)
				);
	if (liked.size === 0) {
		return catalog.map((row) => ({ ...row, viewer_liked: false }));
	}
	return applyViewerLikedFromSet(catalog, liked);
}

async function pullFeedBetaCandidateCatalogFromDb(queries, userId, pageSeed) {
	const params = FEED_BETA_DEFAULT_PARAMS;
	const cat = queries.selectFeedBetaSitewideCatalog;
	if (!cat || typeof cat.getRecent !== 'function') {
		return [];
	}

	const rng = createSeededRng(String(pageSeed ?? userId));
	const backOffset = Math.floor(rng() * Math.max(1, params.backCatalogMaxOffset));
	const olderThan = new Date(
		Date.now() - params.backCatalogMinAgeDays * 24 * 60 * 60 * 1000
	).toISOString();

	const fetches = [
		cat.getRecent(userId, { limit: FEED_BETA_FALLBACK_RECENT_LIMIT }),
		typeof cat.getTopEngaged === 'function'
			? cat.getTopEngaged(userId, { limit: FEED_BETA_FALLBACK_HOT_LIMIT })
			: Promise.resolve([]),
		typeof cat.getBackCatalogSlice === 'function'
			? cat.getBackCatalogSlice(userId, {
					olderThanIso: olderThan,
					offset: backOffset,
					limit: FEED_BETA_FALLBACK_BACK_LIMIT
				})
			: Promise.resolve([])
	];

	let videoRows = [];
	if (typeof queries.selectFeedItems?.getSitePublishedVideoFeedPage === 'function') {
		try {
			const vidPage = await queries.selectFeedItems.getSitePublishedVideoFeedPage(userId, {
				mode: 'head',
				limit: params.slotPackVideoCap + 24
			});
			videoRows = Array.isArray(vidPage?.rows) ? vidPage.rows : [];
		} catch {
			videoRows = [];
		}
	}

	const [recent, engaged, backSlice] = await Promise.all(fetches);
	return mergeCatalogRowsById(recent, engaged, backSlice, videoRows).map(normalizeFeedBetaMediaFields);
}

/**
 * @param {object|null|undefined} snapshot
 * @returns {{ newcomerAuthorIds: Set<string>, newcomerHandles: Set<string> }|null}
 */
export function newcomerContextFromSnapshot(snapshot) {
	if (!snapshot || !Array.isArray(snapshot.newcomer_author_ids)) return null;
	return {
		newcomerAuthorIds: new Set(snapshot.newcomer_author_ids.map((id) => String(id))),
		newcomerHandles: new Set(
			(Array.isArray(snapshot.newcomer_handles) ? snapshot.newcomer_handles : [])
				.map((h) => String(h).trim().toLowerCase())
				.filter(Boolean)
		)
	};
}

/**
 * @param {object} queries
 * @param {number} userId
 * @param {string} pageSeed
 * @param {{ deferLikes?: boolean }} [opts]
 * @returns {Promise<{ catalog: object[], publishedCount: number|null, fromSnapshot: boolean, snapshotNewcomer: object|null }>}
 */
export async function pullFeedBetaCandidateCatalogBundle(queries, userId, pageSeed, opts = {}) {
	const snapshot = await loadFeedBetaCatalogSnapshotCached();
	let catalog = [];
	let publishedCount = null;
	let fromSnapshot = false;
	let snapshotNewcomer = null;

	if (snapshot) {
		catalog = catalogFromSnapshot(snapshot, pageSeed);
		const cached = Number(snapshot.published_count);
		if (Number.isFinite(cached) && cached >= 0) publishedCount = cached;
		fromSnapshot = true;
		snapshotNewcomer = newcomerContextFromSnapshot(snapshot);
	} else {
		catalog = await pullFeedBetaCandidateCatalogFromDb(queries, userId, pageSeed);
	}

	if (opts.deferLikes === true) {
		return { catalog, publishedCount, fromSnapshot, snapshotNewcomer };
	}

	catalog = await applyViewerLikedToCatalog(queries, userId, catalog);
	return { catalog, publishedCount, fromSnapshot, snapshotNewcomer };
}

/**
 * Sitewide candidate set: shared Redis snapshot when available, else smaller live DB pull.
 *
 * @param {object} queries
 * @param {number} userId
 * @param {string} pageSeed — varies per page / refresh for back-catalog offset
 */
export async function pullFeedBetaCandidateCatalog(queries, userId, pageSeed) {
	const bundle = await pullFeedBetaCandidateCatalogBundle(queries, userId, pageSeed);
	return bundle.catalog;
}

/**
 * Published count from snapshot when cached, else live count query.
 *
 * @param {object} queries
 * @param {number|null} [cachedPublishedCount]
 */
export async function resolveFeedBetaSitewideCatalogSize(queries, cachedPublishedCount = null) {
	if (cachedPublishedCount != null) {
		const cached = Number(cachedPublishedCount);
		if (Number.isFinite(cached) && cached >= 0) return cached;
	}

	const snapshot = await loadFeedBetaCatalogSnapshotCached();
	const fromSnap = Number(snapshot?.published_count);
	if (Number.isFinite(fromSnap) && fromSnap >= 0) return fromSnap;

	const cat = queries?.selectFeedBetaSitewideCatalog;
	if (cat && typeof cat.getPublishedCount === 'function') {
		try {
			return await cat.getPublishedCount();
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Mobile slot-pack spotlight videos — same source as legacy feed (`getLatestFeedSlotPackHead` video lane).
 * Does not filter by seen; spotlight always shows newest site-wide videos.
 * @param {object} queries
 * @param {number} userId
 * @param {{ limit?: number, enableNsfw?: boolean, showOwnPosts?: boolean }} [opts]
 * @returns {Promise<object[]>}
 */
export async function pullFeedBetaSlotPackVideoHead(queries, userId, opts = {}) {
	const limit = Math.max(1, Number(opts.limit) || FEED_BETA_DEFAULT_PARAMS.slotPackVideoCap);
	if (typeof queries.selectFeedItems?.getLatestFeedSlotPackHead === 'function') {
		try {
			const head = await queries.selectFeedItems.getLatestFeedSlotPackHead(userId, {
				videoLimit: limit,
				imageLimit: 1,
				includeOwnPosts: opts.showOwnPosts === true
			});
			let rows = (Array.isArray(head?.videos) ? head.videos : []).map(normalizeFeedBetaMediaFields);
			if (opts.enableNsfw !== true) {
				rows = rows.filter((row) => !row.nsfw);
			}
			return rows.filter(feedRowIsVideoThread);
		} catch {
			// fall through to site video page
		}
	}
	return pullFeedBetaSiteVideoHead(queries, userId, { ...opts, seen: null });
}

/**
 * Site-wide newest videos (catalog supplement).
 *
 * @param {object} queries
 * @param {number} userId
 * @param {{ limit?: number, enableNsfw?: boolean, seen?: Set<string> }} [opts]
 */
export async function pullFeedBetaSiteVideoHead(queries, userId, opts = {}) {
	const limit = Math.max(1, Number(opts.limit) || FEED_BETA_DEFAULT_PARAMS.slotPackVideoCap);
	if (typeof queries.selectFeedItems?.getSitePublishedVideoFeedPage !== 'function') {
		return [];
	}
	try {
		const page = await queries.selectFeedItems.getSitePublishedVideoFeedPage(userId, {
			mode: 'head',
			limit
		});
		let rows = (Array.isArray(page?.rows) ? page.rows : []).map(normalizeFeedBetaMediaFields);
		if (opts.enableNsfw !== true) {
			rows = rows.filter((row) => !row.nsfw);
		}
		const seen = opts.seen instanceof Set ? opts.seen : null;
		if (seen) {
			rows = rows.filter((row) => {
				const key = feedRowCreationIdKey(row);
				return key && !isFeedBetaRowExcludedFromPools(row, seen);
			});
		}
		return rows.filter(feedRowIsVideoThread);
	} catch {
		return [];
	}
}
