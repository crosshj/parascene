import { authorCountsFromRows } from './creatorCap.js';
import { FEED_BETA_DEFAULT_PARAMS } from './params.js';
import { stampFeedBetaRowReason } from './reason.js';
import { feedRowCreationIdKey, normalizeFeedBetaMediaFields } from './rowMedia.js';
import { isFeedBetaRelaxedPage, isFeedBetaRowExcludedFromPools } from './seen.js';

/**
 * @param {object|null|undefined} row
 * @param {object} opts
 * @returns {boolean}
 */
function rowEligibleForRandomFallback(row, opts) {
	if (!row || typeof row !== 'object') return false;
	if (!opts.enableNsfw && row.nsfw) return false;
	if (!feedRowCreationIdKey(row)) return false;
	if (
		!opts.showOwnPosts &&
		opts.viewerUserId != null &&
		String(row.user_id) === String(opts.viewerUserId)
	) {
		return false;
	}
	const key = feedRowCreationIdKey(row);
	if (key && opts.excludeKeys.has(key)) return false;
	if (isFeedBetaRowExcludedFromPools(row, opts.servedSeen, { relaxed: opts.relaxed })) {
		return false;
	}
	return true;
}

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
	const excludeKeys = new Set();
	for (const row of existing) {
		const key = feedRowCreationIdKey(row);
		if (key) excludeKeys.add(key);
	}

	const authorCounts = authorCountsFromRows(existing);
	const maxPerCreator = params.maxCreationsPerAuthorPerPage;
	const fetchLimit = Math.min(
		Math.max(needed * 6, needed + 8),
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

	const filterOpts = {
		enableNsfw: opts.enableNsfw === true,
		showOwnPosts: opts.showOwnPosts === true,
		viewerUserId: userId,
		excludeKeys,
		servedSeen,
		relaxed
	};

	const stampBase = {
		pool: 'db_random_fallback',
		thread: null,
		page_index: pageIndex,
		page_seed: opts.pageSeed ?? null,
		source: 'db_random_fallback',
		relax_filters: relaxed
	};

	const out = [...existing];
	for (const raw of candidates) {
		if (out.length >= safeLimit) break;
		const row = normalizeFeedBetaMediaFields(raw);
		if (!rowEligibleForRandomFallback(row, filterOpts)) continue;

		const key = feedRowCreationIdKey(row);
		const uid = String(row.user_id ?? '');
		if (uid) {
			const n = authorCounts.get(uid) || 0;
			if (n >= maxPerCreator) continue;
			authorCounts.set(uid, n + 1);
		}
		if (key) excludeKeys.add(key);

		out.push(
			stampFeedBetaRowReason(row, stampBase, null)
		);
	}

	return out;
}
