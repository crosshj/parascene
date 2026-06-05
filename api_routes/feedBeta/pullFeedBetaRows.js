import {
	buildBetaPageFeedCursor,
	isFeedBetaPageCursor,
	pageIndexAfterBetaCursor
} from './cursor.js';
import { buildFeedBetaContinuation } from './continuation.js';
import { pullFeedBetaCandidateCatalog } from './catalog.js';
import { FEED_BETA_DEFAULT_PARAMS } from './params.js';
import { mergeBetaPage, sortFeedBetaRowsNewestFirst } from './mergeBetaPage.js';
import { drawMobileEditorialSlotPackPage } from './mobileSlotPack.js';
import { buildFeedBetaScoreContext, sampleThreadRows } from './pools.js';
import { computeBetaHasMore } from './hasMore.js';
import { ensureBetaPageFilledToLimit } from './fillPageToLimit.js';
import { getFeedBetaSeenSet, loadFeedBetaSeenSetForUser } from './seen.js';
import { feedRowCreationIdKey, normalizeFeedBetaMediaFields } from './rowMedia.js';
import { appendFeedBetaMergeReason } from './reason.js';

/**
 * @param {object} opts
 * @returns {number}
 */
function resolveBetaPageIndex({ slotPack, offset, afterAt, afterIdNum, limit, feedBetaAck }) {
	if (slotPack && offset === 0 && !isFeedBetaPageCursor(afterAt, afterIdNum)) {
		return 1;
	}
	if (isFeedBetaPageCursor(afterAt, afterIdNum)) {
		return pageIndexAfterBetaCursor(afterIdNum);
	}
	const ackPage = Number(feedBetaAck?.completed_page);
	if (Number.isFinite(ackPage) && ackPage >= 1) {
		return ackPage + 1;
	}
	const safeLimit = Math.max(1, Number(limit) || 20);
	return Math.floor(Math.max(0, offset) / safeLimit) + 1;
}

/**
 * Seed for pool draws — page 1 reshuffles on each open; later pages get a stable per-page seed.
 * @param {number} userId
 * @param {number} pageIndex
 * @param {boolean} refresh
 */
function buildPageShuffleSeed(userId, pageIndex, refresh) {
	if (pageIndex === 1) {
		return `${userId}:p1:${refresh ? Date.now() : 'open'}`;
	}
	return `${userId}:p${pageIndex}`;
}

/**
 * @param {object} args
 */
export async function pullFeedBetaRows({
	queries,
	user,
	limit,
	offset,
	slotPack,
	afterAt,
	afterIdNum,
	enableNsfw,
	showOwnPosts,
	refresh = false,
	feedBetaAck = null,
	seenSet = null
}) {
	const userId = user.id;
	const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
	const pageIndex = resolveBetaPageIndex({
		slotPack,
		offset,
		afterAt,
		afterIdNum,
		limit: safeLimit,
		feedBetaAck
	});
	const previousPageUnfilled = feedBetaAck?.page_filled === false;
	const isSlotPackPageOne = Boolean(slotPack) && pageIndex === 1;
	const isContinuation = pageIndex > 1 || (!slotPack && offset > 0);
	const seen = seenSet instanceof Set ? seenSet : getFeedBetaSeenSet(user);
	const params = FEED_BETA_DEFAULT_PARAMS;

	const pageSeed = buildPageShuffleSeed(userId, pageIndex, refresh);
	const shuffleSeed = pageSeed;
	const catalog = await pullFeedBetaCandidateCatalog(queries, userId, pageSeed);
	const scoreContext = await buildFeedBetaScoreContext(queries, userId, catalog);

	const sampleOpts = {
		catalog,
		scoreContext,
		pageSeed,
		pageIndex,
		seen,
		enableNsfw,
		showOwnPosts: showOwnPosts === true,
		shuffleSeed
	};

	let mergedRows;
	if (isSlotPackPageOne) {
		const slotRows = drawMobileEditorialSlotPackPage(catalog, {
			...sampleOpts,
			viewerUserId: userId,
			scoreContext,
			pageSeed,
			pageIndex
		});
		mergedRows = slotRows.map((row, index) =>
			appendFeedBetaMergeReason(row, {
				merge_layout: 'mobile_editorial_slot',
				position_in_page: index + 1
			})
		);
	} else {
		const videoTake = Math.ceil(safeLimit / 2) + 6;
		const otherTake = Math.ceil(safeLimit / 2) + 6;

		const [videoRows, otherRows] = await Promise.all([
			sampleThreadRows(queries, userId, { ...sampleOpts, thread: 'video', take: videoTake }),
			sampleThreadRows(queries, userId, { ...sampleOpts, thread: 'other', take: otherTake })
		]);

		({ rows: mergedRows } = mergeBetaPage({
			videoRows,
			otherRows,
			limit: safeLimit,
			slotPackPageOne: false,
			pageIndex
		}));
	}

	let rows = mergedRows.map((row) => {
		const norm = normalizeFeedBetaMediaFields(row);
		if (row?.feed_beta_why) {
			norm.feed_beta_why = row.feed_beta_why;
		}
		return norm;
	});

	if (rows.length < safeLimit) {
		rows = await ensureBetaPageFilledToLimit(queries, userId, {
			rows,
			safeLimit,
			pageSeed,
			pageIndex,
			servedSeen: seen,
			enableNsfw,
			showOwnPosts: showOwnPosts === true,
			catalog,
			forceRelaxFill: previousPageUnfilled
		});
		rows = rows.map((row) => {
			const norm = normalizeFeedBetaMediaFields(row);
			if (row?.feed_beta_why) {
				norm.feed_beta_why = row.feed_beta_why;
			}
			return norm;
		});
	}

	if (pageIndex === 1 && rows.length > 1 && !isSlotPackPageOne) {
		rows = sortFeedBetaRowsNewestFirst(rows);
	}

	let sitewideCatalogSize = null;
	const sitewideCat = queries.selectFeedBetaSitewideCatalog;
	if (sitewideCat && typeof sitewideCat.getPublishedCount === 'function') {
		try {
			sitewideCatalogSize = await sitewideCat.getPublishedCount(userId);
		} catch {
			sitewideCatalogSize = null;
		}
	}

	const hasMore = computeBetaHasMore({
		pageIndex,
		rows,
		safeLimit,
		catalog,
		servedSeen: seen,
		params,
		isSlotPackPageOne,
		sitewideCatalogSize
	});

	const result = {
		rows,
		hasMore,
		isNewbieFeed: false,
		mobileChatSlotPackPageOne: isSlotPackPageOne,
		mobileChatSlotPackContinuation: isContinuation && !isSlotPackPageOne,
		feedBetaServedIds: creationIdsFromBetaRows(rows),
		feedBetaPageCursor: buildBetaPageFeedCursor(pageIndex),
		feedBetaContinuation: buildFeedBetaContinuation({
			pageIndex,
			rows,
			safeLimit,
			catalog,
			servedSeen: seen,
			params,
			isSlotPackPageOne,
			sitewideCatalogSize,
			hasMore
		})
	};

	/** @deprecated use feedBetaPageCursor */
	result.slotPackFeedCursor = result.feedBetaPageCursor;

	return result;
}

/**
 * @param {object[]} rows
 * @returns {string[]}
 */
export function creationIdsFromBetaRows(rows) {
	const out = [];
	for (const row of Array.isArray(rows) ? rows : []) {
		const key = feedRowCreationIdKey(row);
		if (key) out.push(key);
	}
	return out;
}
