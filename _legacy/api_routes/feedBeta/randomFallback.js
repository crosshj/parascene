import { FEED_BETA_DEFAULT_PARAMS } from './params.js';
import { appendBetaPageFillCandidates } from './fillPageToLimit.js';
import { isFeedBetaRelaxedPage } from './seen.js';

/**
 * When ranked pool draws under-fill a page, backfill from a seeded random DB slice.
 *
 * @param {object} queries
 * @param {number} userId
 * @param {object} opts
 * @param {object[]} opts.rows — rows already on this page
 * @param {number} opts.safeLimit
 * @param {string} opts.pageSeed
 * @param {number} opts.pageIndex
 * @param {Set<string>} opts.servedSeen
 * @param {boolean} opts.enableNsfw
 * @param {boolean} opts.showOwnPosts
 * @returns {Promise<object[]>}
 */
export async function supplementBetaPageFromRandomFallback(queries, userId, opts) {
	const params = FEED_BETA_DEFAULT_PARAMS;
	const existing = Array.isArray(opts.rows) ? opts.rows : [];
	const safeLimit = Math.min(Math.max(1, Number(opts.safeLimit) || 20), 100);
	const needed = safeLimit - existing.length;
	if (needed <= 0) return existing;

	const getRandom = queries.selectFeedBetaSitewideCatalog?.getRandomSlice;
	if (typeof getRandom !== 'function') return existing;

	const pageIndex = Math.max(1, Number(opts.pageIndex) || 1);
	const relaxed = isFeedBetaRelaxedPage(pageIndex, params);
	const servedSeen = opts.servedSeen instanceof Set ? opts.servedSeen : new Set();
	const fetchLimit = Math.min(
		Math.max(needed * 8, needed + 16),
		params.randomFallbackFetchLimit
	);

	let candidates = [];
	try {
		candidates = await getRandom(userId, {
			seed: `${opts.pageSeed ?? userId}:random-fallback`,
			limit: fetchLimit
		});
	} catch {
		return existing;
	}

	return appendBetaPageFillCandidates(existing, candidates, {
		safeLimit,
		pageSeed: opts.pageSeed ?? null,
		pageIndex,
		servedSeen,
		enableNsfw: opts.enableNsfw === true,
		showOwnPosts: opts.showOwnPosts === true,
		viewerUserId: userId,
		relaxFilters: relaxed,
		stampBase: {
			pool: 'db_random_fallback',
			thread: null,
			page_index: pageIndex,
			page_seed: opts.pageSeed ?? null,
			source: 'db_random_fallback',
			relax_filters: relaxed
		}
	});
}
