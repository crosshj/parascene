import {
	buildFeedPageCursor,
	isFeedPageCursor,
	pageIndexAfterFeedCursor
} from "./cursor.js";
import { buildFeedContinuation } from "./continuation.js";
import {
	pullFeedCandidateCatalogBundle,
	resolveFeedSitewideCatalogSize,
	applyViewerLikedFromSet,
	applyViewerLikedToCatalog,
	applyViewerLikedToRows,
	loadViewerLikedCreationIdSetForUser,
	pullFeedSlotPackVideoHead
} from "./catalog.js";
import { loadFollowingIdSet } from "./context.js";
import { FEED_DEFAULT_PARAMS } from "./params.js";
import { mergeFeedPage, sortFeedRowsNewestFirst } from "./mergeFeedPage.js";
import { drawMobileEditorialSlotPackPage } from "./mobileSlotPack.js";
import { buildFeedScoreContext, sampleThreadRows } from "./pools.js";
import { computeFeedHasMore } from "./hasMore.js";
import { ensureFeedPageFilledToLimit, fillFeedPageFromPast } from "./fillPageToLimit.js";
import {
	createFeedSession,
	isFeedSessionStoreAvailable,
	loadFeedSession,
	saveFeedSession
} from "./feedSession.js";
import { loadFeedSeenSetForUser } from "./seen.js";
import { feedRowCreationIdKey, normalizeFeedMediaFields } from "./rowMedia.js";
import { appendFeedMergeReason } from "./reason.js";
import { wrapTimedPromise } from "../feedTiming.js";

/**
 * @param {object} opts
 * @returns {number}
 */
function resolveFeedPageIndex({ slotPack, offset, afterAt, afterIdNum, limit, feedAck }) {
	if (slotPack && offset === 0 && !isFeedPageCursor(afterAt, afterIdNum)) {
		return 1;
	}
	if (isFeedPageCursor(afterAt, afterIdNum)) {
		return pageIndexAfterFeedCursor(afterIdNum);
	}
	const ackPage = Number(feedAck?.completed_page);
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
export async function pullFeedRows({
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
	feedAck = null,
	seenSet = null,
	timing = null
}) {
	const userId = user.id;
	const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
	const pageIndex = resolveFeedPageIndex({
		slotPack,
		offset,
		afterAt,
		afterIdNum,
		limit: safeLimit,
		feedAck
	});
	const previousPageUnfilled = feedAck?.page_filled === false;
	const isSlotPackPageOne = Boolean(slotPack) && pageIndex === 1;
	const isContinuation = pageIndex > 1 || (!slotPack && offset > 0);
	const params = FEED_DEFAULT_PARAMS;

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
			: loadFeedSeenSetForUser(queries, user)
	);
	const canLoadLikes = typeof queries?.selectViewerLikedCreationIdsByUser?.all === 'function';
	const likedPromise = wrapTimedPromise(
		timing,
		'pull.likes',
		canLoadLikes ? loadViewerLikedCreationIdSetForUser(queries, userId) : Promise.resolve(null)
	);
	const sessionPromise = !isFeedSessionStoreAvailable()
		? Promise.resolve(null)
		: pageIndex === 1
			? Promise.resolve(createFeedSession())
			: wrapTimedPromise(timing, 'pull.session', loadFeedSession(userId, feedAck?.session_id));
	const catalogPromise = wrapTimedPromise(
		timing,
		'pull.catalog',
		pullFeedCandidateCatalogBundle(queries, userId, pageSeed, {
			deferLikes: true
		})
	);
	const parallelWallStart = performance.now();
	const [seen, bundle, likedSet, session] = await Promise.all([seenPromise, catalogPromise, likedPromise, sessionPromise]);
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
				buildFeedScoreContext(queries, userId, catalog, {
					followingIds,
					pageIndex,
					snapshotNewcomer
				})
			)
		: await buildFeedScoreContext(queries, userId, catalog, {
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
		sessionServed: session?.served ?? null,
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
						pullFeedSlotPackVideoHead(queries, userId, {
							limit: params.slotPackVideoCap + 24,
							enableNsfw,
							showOwnPosts: showOwnPosts === true
						})
					)
				: pullFeedSlotPackVideoHead(queries, userId, {
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
			appendFeedMergeReason(row, {
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

		({ rows: mergedRows } = mergeFeedPage({
			videoRows,
			otherRows,
			limit: safeLimit,
			slotPackPageOne: false,
			pageIndex
		}));
	}

	let rows = mergedRows.map((row) => {
		const norm = normalizeFeedMediaFields(row);
		if (row?.feed_why) {
			norm.feed_why = row.feed_why;
		}
		return norm;
	});

	// Ranked pools ran dry for this visit: continue through the past instead of random backfill.
	if (session && pageIndex > 1 && rows.length < safeLimit) {
		const pastOpts = { rows, safeLimit, session, pageIndex, pageSeed, enableNsfw, showOwnPosts: showOwnPosts === true };
		rows = await (timing
			? timing.timeAsync('pull.past_fill', () => fillFeedPageFromPast(queries, userId, pastOpts))
			: fillFeedPageFromPast(queries, userId, pastOpts));
		rows = rows.map((row) => {
			const norm = normalizeFeedMediaFields(row);
			if (row?.feed_why) norm.feed_why = row.feed_why;
			return norm;
		});
	} else if (rows.length < safeLimit) {
		rows = await (timing
			? timing.timeAsync('pull.page_fill', () =>
					ensureFeedPageFilledToLimit(queries, userId, {
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
			: ensureFeedPageFilledToLimit(queries, userId, {
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
			const norm = normalizeFeedMediaFields(row);
			if (row?.feed_why) {
				norm.feed_why = row.feed_why;
			}
			return norm;
		});
	}

	if (pageIndex === 1 && rows.length > 1) {
		rows = sortFeedRowsNewestFirst(rows);
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
					resolveFeedSitewideCatalogSize(queries, catalogPublishedCount)
				)
			: resolveFeedSitewideCatalogSize(queries, catalogPublishedCount));
	} catch {
		sitewideCatalogSize = null;
	}

	if (session) {
		for (const key of creationIdsFromFeedRows(rows)) session.served.add(key);
		await (timing
			? timing.timeAsync('pull.session_save', () => saveFeedSession(userId, session))
			: saveFeedSession(userId, session));
	}

	// With a session, the feed ends only when this visit has walked back past the oldest creation;
	// seen coverage of the site no longer ends scroll for heavy viewers.
	const hasMore = session
		? rows.length > 0 && !session.tailExhausted
		: timing
		? timing.time('pull.has_more', () =>
				computeFeedHasMore({
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
		: computeFeedHasMore({
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
		feedServedIds: creationIdsFromFeedRows(rows),
		feedPageCursor: buildFeedPageCursor(pageIndex),
		feedContinuation: {
			...buildFeedContinuation({
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
			...(session ? { session_id: session.id, past_active: session.tail != null } : {})
		},
		feedTimingMeta: {
			pageIndex,
			fromSnapshot,
			catalogSize: catalog.length,
			slotPackPageOne: isSlotPackPageOne,
			rowCount: rows.length
		}
	};

	/** @deprecated use feedPageCursor */
	result.slotPackFeedCursor = result.feedPageCursor;

	return result;
}

/**
 * @param {object[]} rows
 * @returns {string[]}
 */
export function creationIdsFromFeedRows(rows) {
	const out = [];
	for (const row of Array.isArray(rows) ? rows : []) {
		const key = feedRowCreationIdKey(row);
		if (key) out.push(key);
	}
	return out;
}
