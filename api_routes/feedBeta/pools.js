import { FEED_BETA_DEFAULT_PARAMS } from './params.js';
import { pullFeedBetaCandidateCatalog } from './catalog.js';
import { loadFollowingIdSet, loadNewcomerAuthorContext } from './context.js';
import { isFeedBetaRowExcludedFromPools, isFeedBetaRelaxedPage } from './seen.js';
import { stampFeedBetaRowReason } from './reason.js';
import { createSeededRng, shuffleInPlace } from './rng.js';
import { scoreFeedBetaRow } from './score.js';
import {
	feedRowCreationIdKey,
	feedRowIsOtherThread,
	feedRowIsVideoThread,
	normalizeFeedBetaMediaFields
} from './rowMedia.js';

/**
 * @param {object} row
 * @param {boolean} enableNsfw
 * @param {number} viewerUserId
 * @param {boolean} showOwnPosts
 * @returns {boolean}
 */
function rowVisible(row, enableNsfw, viewerUserId, showOwnPosts) {
	if (!row || typeof row !== 'object') return false;
	if (!enableNsfw && row.nsfw) return false;
	if (!feedRowCreationIdKey(row)) return false;
	if (!showOwnPosts && viewerUserId != null && String(row.user_id) === String(viewerUserId)) {
		return false;
	}
	return true;
}

/**
 * @param {object[]} catalog
 * @param {'video'|'other'} thread
 * @returns {object[]}
 */
function filterThreadCatalog(catalog, thread, enableNsfw, viewerUserId, showOwnPosts) {
	return (Array.isArray(catalog) ? catalog : [])
		.map(normalizeFeedBetaMediaFields)
		.filter(
			(row) =>
				rowVisible(row, enableNsfw, viewerUserId, showOwnPosts) &&
				(thread === 'video' ? feedRowIsVideoThread(row) : feedRowIsOtherThread(row))
		);
}

/**
 * @param {object} stampBase
 * @param {object} entry
 * @param {string} pool
 * @returns {object}
 */
function rowWithPoolReason(stampBase, entry, pool) {
	return stampFeedBetaRowReason(entry.row, { ...stampBase, pool, source: 'pool_draw' }, entry);
}

/**
 * @param {object[]} scored
 * @param {Set<string>} seen
 * @param {number} take
 * @param {Set<string>} used
 * @param {string} pool
 * @param {object} stampBase
 * @returns {object[]}
 */
function takeRowsFromScored(scored, seen, take, used, pool, stampBase, skipSeenFilter = false) {
	const out = [];
	for (const entry of scored) {
		if (out.length >= take) break;
		const key = feedRowCreationIdKey(entry.row);
		if (
			!key ||
			(!skipSeenFilter && isFeedBetaRowExcludedFromPools(entry.row, seen)) ||
			used.has(key)
		) {
			continue;
		}
		used.add(key);
		out.push(rowWithPoolReason(stampBase, entry, pool));
	}
	return out;
}

/**
 * @param {object[]} entries
 * @param {number} take
 * @param {() => number} rng
 * @param {string} pool
 * @param {object} stampBase
 * @param {Set<string>} seen
 * @param {Set<string>} used
 * @returns {object[]}
 */
function weightedSampleWithReason(entries, take, rng, pool, stampBase, seen, used, skipSeenFilter = false) {
	if (take <= 0 || entries.length === 0) return [];
	const poolCopy = entries.slice();
	const out = [];
	while (out.length < take && poolCopy.length > 0) {
		const total = poolCopy.reduce((sum, e) => sum + Math.max(0.01, e.score), 0);
		let pick = rng() * total;
		let idx = 0;
		for (; idx < poolCopy.length; idx += 1) {
			pick -= Math.max(0.01, poolCopy[idx].score);
			if (pick <= 0) break;
		}
		const chosen = poolCopy.splice(Math.min(idx, poolCopy.length - 1), 1)[0];
		if (!chosen) continue;
		const key = feedRowCreationIdKey(chosen.row);
		if (
			!key ||
			(!skipSeenFilter && isFeedBetaRowExcludedFromPools(chosen.row, seen)) ||
			used.has(key)
		) {
			continue;
		}
		used.add(key);
		out.push(rowWithPoolReason(stampBase, chosen, pool));
	}
	return out;
}

/**
 * Per-page pool draws (same model every page): hot 24h, hot 7d, new, newcomer, unseen catalog, follow sprinkle.
 * Each returned row carries `feed_beta_why` stamped at draw time.
 * @param {object[]} catalog
 * @param {object} opts
 * @returns {object[]}
 */
export function drawThreadPageFromCatalog(catalog, opts) {
	const params = FEED_BETA_DEFAULT_PARAMS;
	const thread = opts.thread;
	const take = Math.max(1, Number(opts.take) || 20);
	const pageIndex = Math.max(1, Number(opts.pageIndex) || 1);
	const relaxed = isFeedBetaRelaxedPage(pageIndex, params);
	const seen =
		opts.ignoreSeen === true ? new Set() : opts.seen instanceof Set ? opts.seen : new Set();
	const shuffleSeed = opts.shuffleSeed != null ? String(opts.shuffleSeed) : null;
	const ctx = opts.scoreContext;
	const enableNsfw = opts.enableNsfw === true;
	const viewerUserId = opts.viewerUserId;
	const showOwnPosts = opts.showOwnPosts === true;
	const skipSeenFilter = opts.ignoreSeen === true || relaxed;
	const stampBase = {
		thread,
		page_index: pageIndex,
		page_seed: opts.pageSeed ?? shuffleSeed,
		ignore_seen: opts.ignoreSeen === true,
		relax_filters: relaxed
	};

	const threadRows = filterThreadCatalog(catalog, thread, enableNsfw, viewerUserId, showOwnPosts).filter(
		(row) => {
			const key = feedRowCreationIdKey(row);
			return key && !isFeedBetaRowExcludedFromPools(row, seen, { relaxed });
		}
	);

	const scored = threadRows.map((row) => {
		const parts = scoreFeedBetaRow(row, ctx);
		return { row, ...parts };
	});

	if (scored.length === 0) return [];

	const rng = shuffleSeed ? createSeededRng(shuffleSeed) : Math.random;
	const used = new Set();

	const hot24Pool = scored
		.filter((e) => e.inHot24 && e.engagement > 0)
		.sort((a, b) => b.engagement - a.engagement || b.score - a.score);
	const hot7Pool = scored
		.filter((e) => e.inHot7 && e.engagement > 0 && !e.inHot24)
		.sort((a, b) => b.engagement - a.engagement || b.score - a.score);
	const newPool = scored
		.filter((e) => e.isNewPublish)
		.sort((a, b) => a.ageHours - b.ageHours || b.score - a.score);
	const newcomerPool = scored
		.filter((e) => e.isNewcomer)
		.sort((a, b) => b.score - a.score);
	const followPool = scored.filter((e) => e.isFollow).sort((a, b) => b.score - a.score);
	const unseenPool = scored.slice().sort((a, b) => b.score - a.score);

	if (shuffleSeed) {
		shuffleInPlace(hot24Pool, rng);
		shuffleInPlace(hot7Pool, rng);
		shuffleInPlace(newPool, rng);
		shuffleInPlace(newcomerPool, rng);
		shuffleInPlace(followPool, rng);
		shuffleInPlace(unseenPool, rng);
	}

	const catalogPoolId = relaxed ? 'catalog_relaxed' : 'catalog_unseen';

	const out = [];
	out.push(
		...takeRowsFromScored(hot24Pool, seen, params.hot24Take, used, 'hot_24h', stampBase, skipSeenFilter)
	);
	out.push(
		...takeRowsFromScored(hot7Pool, seen, params.hot7Take, used, 'hot_7d', stampBase, skipSeenFilter)
	);
	out.push(...takeRowsFromScored(newPool, seen, params.newTake, used, 'new', stampBase, skipSeenFilter));
	out.push(
		...takeRowsFromScored(
			newcomerPool,
			seen,
			params.newcomerTake,
			used,
			'newcomer',
			stampBase,
			skipSeenFilter
		)
	);

	const catalogCandidates = unseenPool.filter((e) => {
		const key = feedRowCreationIdKey(e.row);
		return key && !used.has(key);
	});
	out.push(
		...weightedSampleWithReason(
			catalogCandidates,
			params.catalogTake,
			rng,
			catalogPoolId,
			stampBase,
			seen,
			used,
			skipSeenFilter
		)
	);

	if (followPool.length > 0) {
		out.push(
			...takeRowsFromScored(
				followPool,
				seen,
				params.followTake,
				used,
				'follow_sprinkle',
				stampBase,
				skipSeenFilter
			)
		);
	}

	if (out.length < take) {
		const remainder = unseenPool.filter((e) => {
			const key = feedRowCreationIdKey(e.row);
			return key && !used.has(key);
		});
		out.push(
			...takeRowsFromScored(
				remainder,
				seen,
				take - out.length,
				used,
				'fill_remainder',
				stampBase,
				skipSeenFilter
			)
		);
	}

	return out.slice(0, take);
}

/**
 * @param {object} queries
 * @param {number} userId
 * @param {object} opts
 * @returns {Promise<object[]>}
 */
export async function sampleThreadRows(queries, userId, opts) {
	const catalog =
		Array.isArray(opts.catalog) && opts.catalog.length > 0
			? opts.catalog
			: await pullFeedBetaCandidateCatalog(queries, userId, opts.pageSeed);

	return drawThreadPageFromCatalog(catalog, {
		thread: opts.thread,
		take: opts.take,
		seen: opts.seen,
		ignoreSeen: opts.ignoreSeen === true,
		shuffleSeed: opts.shuffleSeed,
		pageIndex: opts.pageIndex,
		pageSeed: opts.pageSeed,
		scoreContext: opts.scoreContext,
		enableNsfw: opts.enableNsfw,
		viewerUserId: userId,
		showOwnPosts: opts.showOwnPosts
	});
}

/**
 * @param {object} queries
 * @param {number} userId
 * @param {object[]} catalog
 */
export async function buildFeedBetaScoreContext(queries, userId, catalog) {
	const [followingIds, newcomer] = await Promise.all([
		loadFollowingIdSet(queries, userId),
		loadNewcomerAuthorContext(queries, catalog)
	]);
	return {
		nowMs: Date.now(),
		followingIds,
		newcomerAuthorIds: newcomer.newcomerAuthorIds,
		newcomerHandles: newcomer.newcomerHandles,
		params: FEED_BETA_DEFAULT_PARAMS
	};
}
