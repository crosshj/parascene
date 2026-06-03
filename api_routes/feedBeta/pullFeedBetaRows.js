import {
	buildBetaPageFeedCursor,
	isFeedBetaPageCursor,
	pageIndexAfterBetaCursor
} from './cursor.js';
import { pullFeedBetaCandidateCatalog, pullFeedBetaSlotPackVideoHead } from './catalog.js';
import { FEED_BETA_DEFAULT_PARAMS } from './params.js';
import { mergeBetaPage } from './mergeBetaPage.js';
import { buildFeedBetaScoreContext, sampleThreadRows } from './pools.js';
import { computeBetaHasMore } from './hasMore.js';
import { supplementBetaPageFromRandomFallback } from './randomFallback.js';
import { getFeedBetaSeenSet } from './seen.js';
import { feedRowCreationIdKey, normalizeFeedBetaMediaFields } from './rowMedia.js';
import { stampFeedBetaRowReason } from './reason.js';
import {
	MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT,
	MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP
} from '../../src/shared/chatFeedMobilePartition.js';

/**
 * @param {object} opts
 * @returns {number}
 */
function resolveBetaPageIndex({ slotPack, offset, afterAt, afterIdNum, limit }) {
	if (slotPack && offset === 0 && !isFeedBetaPageCursor(afterAt, afterIdNum)) {
		return 1;
	}
	if (isFeedBetaPageCursor(afterAt, afterIdNum)) {
		return pageIndexAfterBetaCursor(afterIdNum);
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
	refresh = false
}) {
	const userId = user.id;
	const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
	const pageIndex = resolveBetaPageIndex({
		slotPack,
		offset,
		afterAt,
		afterIdNum,
		limit: safeLimit
	});
	const isSlotPackPageOne = Boolean(slotPack) && pageIndex === 1;
	const isContinuation = pageIndex > 1 || (!slotPack && offset > 0);
	const seen = getFeedBetaSeenSet(user);
	const params = FEED_BETA_DEFAULT_PARAMS;

	const pageSeed = buildPageShuffleSeed(userId, pageIndex, refresh);
	const shuffleSeed = pageSeed;
	const catalog = await pullFeedBetaCandidateCatalog(queries, userId, pageSeed);
	const scoreContext = await buildFeedBetaScoreContext(queries, userId, catalog);

	const videoTake = isSlotPackPageOne
		? params.slotPackVideoCap + 8
		: Math.ceil(safeLimit / 2) + 6;
	const otherTake = isSlotPackPageOne
		? params.slotPackOtherCap + 8
		: Math.ceil(safeLimit / 2) + 6;

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

	const reasonStamp = { page_index: pageIndex, page_seed: pageSeed };

	const slotPackVideoHeadCount =
		MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT * MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP;

	async function resolveVideoRows() {
		if (!isSlotPackPageOne) {
			return sampleThreadRows(queries, userId, { ...sampleOpts, thread: 'video', take: videoTake });
		}
		const siteVideos = await pullFeedBetaSlotPackVideoHead(queries, userId, {
			limit: slotPackVideoHeadCount,
			enableNsfw,
			showOwnPosts: showOwnPosts === true
		});
		const stampedSite = siteVideos.map((row) =>
			stampFeedBetaRowReason(
				row,
				{
					...reasonStamp,
					pool: 'site_video_head',
					thread: 'video',
					source: 'site_video_head',
					ignore_seen: true
				},
				null
			)
		);
		if (stampedSite.length >= slotPackVideoHeadCount) {
			return stampedSite.slice(0, videoTake);
		}
		const poolVideos = await sampleThreadRows(queries, userId, {
			...sampleOpts,
			thread: 'video',
			take: videoTake,
			ignoreSeen: true
		});
		const byId = new Map();
		for (const row of [...stampedSite, ...poolVideos]) {
			const key = feedRowCreationIdKey(row);
			if (key && !byId.has(key)) byId.set(key, row);
		}
		return [...byId.values()].slice(0, videoTake);
	}

	const [videoRows, otherRows] = await Promise.all([
		resolveVideoRows(),
		sampleThreadRows(queries, userId, { ...sampleOpts, thread: 'other', take: otherTake })
	]);

	const { rows: mergedRows } = mergeBetaPage({
		videoRows,
		otherRows,
		limit: safeLimit,
		slotPackPageOne: isSlotPackPageOne
	});
	let rows = mergedRows.map((row) => {
		const norm = normalizeFeedBetaMediaFields(row);
		if (row?.feed_beta_why) {
			norm.feed_beta_why = row.feed_beta_why;
		}
		return norm;
	});

	if (rows.length < safeLimit) {
		rows = await supplementBetaPageFromRandomFallback(queries, userId, {
			rows,
			safeLimit,
			pageSeed,
			pageIndex,
			servedSeen: seen,
			enableNsfw,
			showOwnPosts: showOwnPosts === true
		});
		rows = rows.map((row) => {
			const norm = normalizeFeedBetaMediaFields(row);
			if (row?.feed_beta_why) {
				norm.feed_beta_why = row.feed_beta_why;
			}
			return norm;
		});
	}

	const hasMore = computeBetaHasMore({
		pageIndex,
		rows,
		safeLimit,
		catalog,
		servedSeen: seen,
		params,
		isSlotPackPageOne
	});

	const result = {
		rows,
		hasMore,
		isNewbieFeed: false,
		mobileChatSlotPackPageOne: isSlotPackPageOne,
		mobileChatSlotPackContinuation: isContinuation && !isSlotPackPageOne,
		feedBetaServedIds: creationIdsFromBetaRows(rows)
	};

	if (slotPack || isFeedBetaPageCursor(afterAt, afterIdNum)) {
		result.slotPackFeedCursor = buildBetaPageFeedCursor(pageIndex);
	}

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
