import {
	buildBetaPageFeedCursor,
	isFeedBetaPageCursor,
	pageIndexAfterBetaCursor
} from './cursor.js';
import { buildFeedBetaContinuation } from './continuation.js';
import {
	pullFeedBetaCandidateCatalogBundle,
	resolveFeedBetaSitewideCatalogSize,
	applyViewerLikedFromSet,
	applyViewerLikedToCatalog,
	applyViewerLikedToRows,
	loadViewerLikedCreationIdSetForUser,
	pullFeedBetaSlotPackVideoHead
} from './catalog.js';
import { loadFollowingIdSet } from './context.js';
import { FEED_BETA_DEFAULT_PARAMS } from './params.js';
import { mergeBetaPage, sortFeedBetaRowsNewestFirst } from './mergeBetaPage.js';
import { drawMobileEditorialSlotPackPage } from './mobileSlotPack.js';
import { buildFeedBetaScoreContext, sampleThreadRows } from './pools.js';
import { computeBetaHasMore } from './hasMore.js';
import { ensureBetaPageFilledToLimit } from './fillPageToLimit.js';
import { loadFeedBetaSeenSetForUser } from './seen.js';
import { feedRowCreationIdKey, normalizeFeedBetaMediaFields } from './rowMedia.js';
import { appendFeedBetaMergeReason } from './reason.js';
import { wrapTimedPromise } from '../feed/feedTiming.js';

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
	seenSet = null,
	timing = null
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
	const params = FEED_BETA_DEFAULT_PARAMS;

	const pageSeed = buildPageShuffleSeed(userId, pageIndex, refresh);
	const shuffleSeed = pageSeed;
	const followingPromise = wrapTimedPromise(
		timing,
		'pull.following',
		loadFollowingIdSet(queries, userId)
	);
	const seenPromise = wrapTimedPromise(
		timing,
		'pull.seen',
		seenSet instanceof Set
			? Promise.resolve(seenSet)
			: loadFeedBetaSeenSetForUser(queries, user)
	);
	const canLoadLikes = typeof queries?.selectViewerLikedCreationIdsByUser?.all === 'function';
	const likedPromise = wrapTimedPromise(
		timing,
		'pull.likes',
		canLoadLikes ? loadViewerLikedCreationIdSetForUser(queries, userId) : Promise.resolve(null)
	);
	const catalogPromise = wrapTimedPromise(
		timing,
		'pull.catalog',
		pullFeedBetaCandidateCatalogBundle(queries, userId, pageSeed, {
			deferLikes: true
		})
	);
	const parallelWallStart = performance.now();
	const [seen, bundle, likedSet] = await Promise.all([seenPromise, catalogPromise, likedPromise]);
	timing?.add('pull.parallel_io_wall', performance.now() - parallelWallStart);
	let { catalog, publishedCount: catalogPublishedCount, fromSnapshot, snapshotNewcomer, videoHead } = bundle;
	if (likedSet instanceof Set) {
		catalog = timing
			? timing.time('pull.apply_likes', () => applyViewerLikedFromSet(catalog, likedSet))
			: applyViewerLikedFromSet(catalog, likedSet);
	} else {
		catalog = await (timing
			? timing.timeAsync('pull.apply_likes', () =>
					applyViewerLikedToCatalog(queries, userId, catalog)
				)
			: applyViewerLikedToCatalog(queries, userId, catalog));
	}
	const followingIds = await followingPromise;
	const scoreContext = timing
		? await timing.timeAsync('pull.score_context', () =>
				buildFeedBetaScoreContext(queries, userId, catalog, {
					followingIds,
					pageIndex,
					snapshotNewcomer
				})
			)
		: await buildFeedBetaScoreContext(queries, userId, catalog, {
				followingIds,
				pageIndex,
				snapshotNewcomer
			});

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
		let spotlightVideoHead = Array.isArray(videoHead) ? videoHead : [];
		if (spotlightVideoHead.length === 0) {
			spotlightVideoHead = await (timing
				? timing.timeAsync('pull.slot_pack_video_head', () =>
						pullFeedBetaSlotPackVideoHead(queries, userId, {
							limit: params.slotPackVideoCap + 24,
							enableNsfw,
							showOwnPosts: showOwnPosts === true
						})
					)
				: pullFeedBetaSlotPackVideoHead(queries, userId, {
						limit: params.slotPackVideoCap + 24,
						enableNsfw,
						showOwnPosts: showOwnPosts === true
					}));
		}
		const slotRows = timing
			? timing.time('pull.slot_pack_draw', () =>
					drawMobileEditorialSlotPackPage(catalog, {
						...sampleOpts,
						viewerUserId: userId,
						scoreContext,
						pageSeed,
						pageIndex,
						videoHead: spotlightVideoHead
					})
				)
			: drawMobileEditorialSlotPackPage(catalog, {
					...sampleOpts,
					viewerUserId: userId,
					scoreContext,
					pageSeed,
					pageIndex,
					videoHead: spotlightVideoHead
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

		const drawStart = performance.now();
		const [videoRows, otherRows] = await Promise.all([
			sampleThreadRows(queries, userId, { ...sampleOpts, thread: 'video', take: videoTake }),
			sampleThreadRows(queries, userId, { ...sampleOpts, thread: 'other', take: otherTake })
		]);
		timing?.add('pull.thread_draw', performance.now() - drawStart);

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
		rows = await (timing
			? timing.timeAsync('pull.page_fill', () =>
					ensureBetaPageFilledToLimit(queries, userId, {
						rows,
						safeLimit,
						pageSeed,
						pageIndex,
						servedSeen: seen,
						enableNsfw,
						showOwnPosts: showOwnPosts === true,
						catalog,
						catalogFromSnapshot: fromSnapshot,
						forceRelaxFill: previousPageUnfilled
					})
				)
			: ensureBetaPageFilledToLimit(queries, userId, {
					rows,
					safeLimit,
					pageSeed,
					pageIndex,
					servedSeen: seen,
					enableNsfw,
					showOwnPosts: showOwnPosts === true,
					catalog,
					catalogFromSnapshot: fromSnapshot,
					forceRelaxFill: previousPageUnfilled
				}));
		rows = rows.map((row) => {
			const norm = normalizeFeedBetaMediaFields(row);
			if (row?.feed_beta_why) {
				norm.feed_beta_why = row.feed_beta_why;
			}
			return norm;
		});
	}

	if (pageIndex === 1 && rows.length > 1) {
		rows = sortFeedBetaRowsNewestFirst(rows);
	}

	rows = await (timing
		? timing.timeAsync('pull.stamp_page_likes', () =>
				applyViewerLikedToRows(queries, userId, rows)
			)
		: applyViewerLikedToRows(queries, userId, rows));

	let sitewideCatalogSize = null;
	try {
		sitewideCatalogSize = await (timing
			? timing.timeAsync('pull.published_count', () =>
					resolveFeedBetaSitewideCatalogSize(queries, catalogPublishedCount)
				)
			: resolveFeedBetaSitewideCatalogSize(queries, catalogPublishedCount));
	} catch {
		sitewideCatalogSize = null;
	}

	const hasMore = timing
		? timing.time('pull.has_more', () =>
				computeBetaHasMore({
					pageIndex,
					rows,
					safeLimit,
					catalog,
					servedSeen: seen,
					params,
					isSlotPackPageOne,
					sitewideCatalogSize
				})
			)
		: computeBetaHasMore({
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
		}),
		feedBetaTimingMeta: {
			pageIndex,
			fromSnapshot,
			catalogSize: catalog.length,
			slotPackPageOne: isSlotPackPageOne,
			rowCount: rows.length
		}
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
