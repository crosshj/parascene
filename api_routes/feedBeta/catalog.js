import { FEED_BETA_DEFAULT_PARAMS } from './params.js';
import { createSeededRng } from './rng.js';
import { isFeedBetaRowExcludedFromPools } from './seen.js';
import { feedRowCreationIdKey, feedRowIsVideoThread, normalizeFeedBetaMediaFields } from './rowMedia.js';

/**
 * Dedupe catalog rows by creation id (newest row wins).
 * @param {object[][]} groups
 * @returns {object[]}
 */
export function mergeCatalogRowsById(...groups) {
	const byId = new Map();
	for (const group of groups) {
		for (const row of Array.isArray(group) ? group : []) {
			if (!row || typeof row !== 'object') continue;
			const key = feedRowCreationIdKey(row);
			if (!key) continue;
			if (!byId.has(key)) byId.set(key, row);
		}
	}
	return [...byId.values()];
}

/**
 * Sitewide candidate set: recent + engaged hits + seeded back-catalog slice + video head.
 * @param {object} queries
 * @param {number} userId
 * @param {string} pageSeed — varies per page / refresh for back-catalog offset
 */
export async function pullFeedBetaCandidateCatalog(queries, userId, pageSeed) {
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
		cat.getRecent(userId, { limit: params.recentFetchLimit }),
		typeof cat.getTopEngaged === 'function'
			? cat.getTopEngaged(userId, { limit: params.hotEngagedFetchLimit })
			: Promise.resolve([]),
		typeof cat.getBackCatalogSlice === 'function'
			? cat.getBackCatalogSlice(userId, {
					olderThanIso: olderThan,
					offset: backOffset,
					limit: params.backCatalogFetchLimit
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
 * Mobile slot-pack spotlight videos — same source as legacy feed (`getLatestFeedSlotPackHead` video lane).
 * Does not filter by `feedBetaSeen`; spotlight always shows newest site-wide videos.
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
 * Site-wide newest videos (catalog supplement). Optional `seen` filter for non-spotlight draws.
 * @param {object} queries
 * @param {number} userId
 * @param {{ limit?: number, enableNsfw?: boolean, seen?: Set<string> }} [opts]
 * @returns {Promise<object[]>}
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
