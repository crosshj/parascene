/**
 * Doom scroll order matches chat `#feed` video order (slot-pack display + tail),
 * not a separate global re-sort by timestamp alone.
 */
import { isFeedRowVideoCreation } from "../../src/shared/chatFeedMobilePartition.js";
import { assembleFeedItems } from "./assembleFeedItems.js";
import { pullChallengeFeedSnapshot } from "./pullChallengeFeedSnapshot.js";
import {
	pullCreationFeedRowsAfterImageCursor,
	pullMobileChatSlotPackFeedPageOne
} from "./pullMobileChatSlotPackFeed.js";
import { transformFeedCreationRow } from "./transformFeedCreationRow.js";

const CHAT_FEED_PAGE_ONE_LIMIT = 28;

/**
 * @param {object[]} items — assembled `/api/feed` items (transformed)
 * @returns {object[]}
 */
export function extractFeedVideosInDisplayOrder(items) {
	const list = Array.isArray(items) ? items : [];
	const out = [];
	const seen = new Set();
	for (const item of list) {
		if (!isFeedRowVideoCreation(item)) continue;
		const rawId = item.created_image_id ?? item.id;
		if (rawId == null || rawId === "") continue;
		const key = String(rawId);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}

/**
 * @param {object[]} seq
 * @param {number} creationId
 */
function indexOfCreationInVideoSeq(seq, creationId) {
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) return -1;
	return seq.findIndex((row) => Number(row?.created_image_id ?? row?.id) === id);
}

/**
 * @param {object[]} pageRows
 */
function doomCursorFromLastRow(pageRows) {
	const last = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;
	if (!last) return null;
	const cid = last.created_image_id ?? last.id;
	if (cid == null || cid === "") return null;
	return { after_created_image_id: String(cid) };
}

/**
 * Page within a feed-order video sequence (anchor at index 0 of returned rows).
 *
 * @param {object[]} seq
 * @param {{ startCreationId?: number, afterCreatedImageId?: number, limit: number }} opts
 */
export function doomPageFromFeedVideoSequence(seq, opts) {
	const safeLimit = Math.min(Math.max(1, Number(opts.limit) || 20), 100);
	const list = Array.isArray(seq) ? seq : [];
	let startIdx = 0;

	if (Number.isFinite(Number(opts.startCreationId)) && Number(opts.startCreationId) > 0) {
		const idx = indexOfCreationInVideoSeq(list, opts.startCreationId);
		if (idx < 0) {
			return { rows: [], hasMore: false, cursor: null, anchorMissing: true };
		}
		startIdx = idx;
	} else if (
		Number.isFinite(Number(opts.afterCreatedImageId)) &&
		Number(opts.afterCreatedImageId) > 0
	) {
		const idx = indexOfCreationInVideoSeq(list, opts.afterCreatedImageId);
		if (idx < 0) {
			return { rows: [], hasMore: false, cursor: null, cursorMissing: true };
		}
		startIdx = idx + 1;
	}

	const pageRows = list.slice(startIdx, startIdx + safeLimit);
	const hasMoreInSeq = startIdx + safeLimit < list.length;
	return {
		rows: pageRows,
		hasMore: hasMoreInSeq,
		cursor: doomCursorFromLastRow(pageRows),
		anchorMissing: false,
		cursorMissing: false
	};
}

/**
 * @param {object} args
 * @param {object} args.queries
 * @param {number} args.viewerId
 * @param {object} args.user — viewer row (`meta`, etc.)
 * @param {boolean} args.showOwnPosts
 * @param {boolean} args.enableNsfw
 */
async function assembleChatFeedItemsForDoom({
	queries,
	viewerId,
	user,
	creationPull,
	challengeSnapshot
}) {
	const { items } = await assembleFeedItems({
		queries,
		user,
		limit: CHAT_FEED_PAGE_ONE_LIMIT,
		offset: 0,
		creationPull,
		challengeSnapshot,
		feedSurface: "chat"
	});
	return items;
}

async function loadChatFeedPageOneForDoom({ queries, viewerId, user, showOwnPosts, enableNsfw }) {
	const creationPull = await pullMobileChatSlotPackFeedPageOne({
		queries,
		userId: viewerId,
		limit: CHAT_FEED_PAGE_ONE_LIMIT,
		showOwnPosts,
		enableNsfw
	});
	let challengeSnapshot = { ok: false };
	try {
		challengeSnapshot = await pullChallengeFeedSnapshot({
			viewerUserId: viewerId,
			queries
		});
	} catch {
		challengeSnapshot = { ok: false };
	}
	const items = await assembleChatFeedItemsForDoom({
		queries,
		viewerId,
		user,
		creationPull,
		challengeSnapshot
	});
	return {
		items,
		feedCursor: creationPull?.slotPackFeedCursor ?? null,
		hasMoreFeed: Boolean(creationPull?.hasMore)
	};
}

async function loadNextChatFeedVideosForDoom({
	queries,
	viewerId,
	user,
	showOwnPosts,
	enableNsfw,
	feedCursor
}) {
	if (!feedCursor?.created_at || feedCursor?.created_image_id == null) {
		return { items: [], feedCursor: null, hasMoreFeed: false };
	}
	const creationPull = await pullCreationFeedRowsAfterImageCursor({
		queries,
		userId: viewerId,
		limit: CHAT_FEED_PAGE_ONE_LIMIT,
		showOwnPosts,
		afterCreatedAt: feedCursor.created_at,
		afterCreatedImageId: feedCursor.created_image_id
	});
	const items = await assembleChatFeedItemsForDoom({
		queries,
		viewerId,
		user,
		creationPull,
		challengeSnapshot: { ok: false }
	});
	return {
		items,
		feedCursor: creationPull?.slotPackFeedCursor ?? null,
		hasMoreFeed: Boolean(creationPull?.hasMore)
	};
}

/**
 * Build deduped chat-feed video list (display order), optionally growing with feed tail pages.
 *
 * @param {object} args
 * @param {object[]} [args.initialItems] — assembled page-one items when already loaded
 * @param {{ created_at: string, created_image_id: number } | null} [args.initialFeedCursor]
 * @param {boolean} [args.initialHasMoreFeed]
 */
export async function buildChatFeedVideoSequenceForDoom(args) {
	const {
		queries,
		viewerId,
		user,
		showOwnPosts,
		enableNsfw,
		initialItems,
		initialFeedCursor,
		initialHasMoreFeed
	} = args;

	let feedCursor = initialFeedCursor ?? null;
	let hasMoreFeed = Boolean(initialHasMoreFeed);
	let items = Array.isArray(initialItems) ? initialItems : null;

	if (!items) {
		const pageOne = await loadChatFeedPageOneForDoom({
			queries,
			viewerId,
			user,
			showOwnPosts,
			enableNsfw
		});
		items = pageOne.items;
		feedCursor = pageOne.feedCursor;
		hasMoreFeed = pageOne.hasMoreFeed;
	}

	/** @type {object[]} */
	let seq = extractFeedVideosInDisplayOrder(items);
	const seen = new Set(seq.map((row) => String(row.created_image_id ?? row.id)));

	const appendItems = (pageItems) => {
		for (const item of extractFeedVideosInDisplayOrder(pageItems)) {
			const key = String(item.created_image_id ?? item.id);
			if (seen.has(key)) continue;
			seen.add(key);
			seq.push(item);
		}
	};

	const growUntil = async (predicate) => {
		let guard = 0;
		while (!predicate() && hasMoreFeed && guard < 12) {
			guard += 1;
			const next = await loadNextChatFeedVideosForDoom({
				queries,
				viewerId,
				user,
				showOwnPosts,
				enableNsfw,
				feedCursor
			});
			if (!next.items?.length) {
				hasMoreFeed = false;
				break;
			}
			appendItems(next.items);
			feedCursor = next.feedCursor;
			hasMoreFeed = next.hasMoreFeed;
		}
	};

	return {
		seq,
		feedCursor,
		hasMoreFeed,
		growUntil,
		appendMore: async () => {
			if (!hasMoreFeed) return false;
			const next = await loadNextChatFeedVideosForDoom({
				queries,
				viewerId,
				user,
				showOwnPosts,
				enableNsfw,
				feedCursor
			});
			if (!next.items?.length) {
				hasMoreFeed = false;
				return false;
			}
			const before = seq.length;
			appendItems(next.items);
			feedCursor = next.feedCursor;
			hasMoreFeed = next.hasMoreFeed;
			return seq.length > before;
		}
	};
}

/**
 * Raw DB rows for site-wide fallback (creation opened outside chat feed list).
 */
export async function pullSiteVideoDoomPageFallback({
	queries,
	viewerId,
	limit,
	mode,
	startCreationId,
	afterCreatedImageId
}) {
	if (typeof queries.selectFeedItems?.getSitePublishedVideoFeedPage !== "function") {
		return { rows: [], hasMore: false, cursor: null };
	}
	const page = await queries.selectFeedItems.getSitePublishedVideoFeedPage(viewerId, {
		limit,
		mode,
		startCreationId,
		afterCreatedImageId
	});
	return {
		rows: (page?.rows ?? []).map(transformFeedCreationRow),
		hasMore: Boolean(page?.hasMore),
		cursor: page?.cursor ?? null
	};
}
