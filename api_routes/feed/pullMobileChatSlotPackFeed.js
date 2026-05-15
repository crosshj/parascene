/**
 * Mobile chat `#feed` slot-pack page one:
 *   1. One query: latest 12 videos + latest 9 images from followed feed.
 *   2. Interleave into 4v+3i × 3 head (in recency order per type).
 *   3. `feed_cursor` = newer of (least-recent head video, least-recent head image). Tail = older than cursor.
 *   4. Page 2+ = plain feed older than `feed_cursor`; response includes advanced `feed_cursor` for the next page.
 */
import {
	MOBILE_CHAT_BETWEEN_SPOTLIGHT_NONVIDEO_SLOTS,
	MOBILE_CHAT_SLOT_PACK_STRUCTURED_LEN,
	MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT,
	MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP
} from "../../src/shared/chatFeedMobilePartition.js";
import { pullCreationFeedRows } from "./pullCreationFeedRows.js";

export function feedRowIsStrictlyOlderThanCursor(row, cursorAt, cursorId) {
	const ra = String(row?.created_at ?? "");
	const ca = String(cursorAt ?? "");
	if (ra < ca) return true;
	if (ra > ca) return false;
	const rid = Number(row?.created_image_id ?? row?.id);
	const cid = Number(cursorId);
	if (!Number.isFinite(rid) || !Number.isFinite(cid))
		return ra === ca && String(row?.created_image_id) < String(cursorId);
	return rid < cid;
}

/**
 * Latest of two raw feed rows by (created_at DESC, created_image_id DESC).
 */
function pickLatest(a, b) {
	if (feedRowIsStrictlyOlderThanCursor(a, b.created_at, b.created_image_id)) return b;
	if (feedRowIsStrictlyOlderThanCursor(b, a.created_at, a.created_image_id)) return a;
	return Number(a.created_image_id ?? a.id) >= Number(b.created_image_id ?? b.id) ? a : b;
}

function rowToCursor(raw) {
	const cid = Number(raw?.created_image_id ?? raw?.id);
	if (!Number.isFinite(cid) || cid <= 0) return null;
	const at = raw?.created_at;
	if (at == null || String(at).length === 0) return null;
	return { created_at: String(at), created_image_id: cid };
}

/**
 * Interleave pre-sorted video and image arrays into 4v+3i × 3 in-order.
 * @param {object[]} videos — raw DB rows, newest first
 * @param {object[]} images — raw DB rows, newest first
 * @returns {object[]}
 */
export function interleaveSlotPackHead(videos, images) {
	const rows = [];
	let vi = 0;
	let ii = 0;
	for (let g = 0; g < MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT; g += 1) {
		for (let v = 0; v < MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP; v += 1) {
			if (vi < videos.length) rows.push(videos[vi++]);
		}
		for (let i = 0; i < MOBILE_CHAT_BETWEEN_SPOTLIGHT_NONVIDEO_SLOTS; i += 1) {
			if (ii < images.length) rows.push(images[ii++]);
		}
	}
	return rows;
}

/**
 * Slot-pack continuation cursor for page 2+:
 * the **newer** of (least-recent video in head, least-recent image in head).
 * Head lists are newest-first, so “least recent” = last element in each list.
 * @param {object[]} rawVideos — newest first (up to 12)
 * @param {object[]} rawImages — newest first (up to 9)
 */
export function latestCursorFromSlotPackHeadLists(rawVideos, rawImages) {
	const leastRecentVideo = rawVideos.length > 0 ? rawVideos[rawVideos.length - 1] : null;
	const leastRecentImage = rawImages.length > 0 ? rawImages[rawImages.length - 1] : null;
	if (!leastRecentVideo && !leastRecentImage) return null;
	const boundary =
		leastRecentVideo && leastRecentImage
			? pickLatest(leastRecentVideo, leastRecentImage)
			: leastRecentVideo ?? leastRecentImage;
	return rowToCursor(boundary);
}

/**
 * Oldest creation row in a feed page (for advancing `feed_cursor` after cursor-based load-more).
 * @param {object[]} rows
 */
export function oldestCreationCursorFromFeedRows(rows) {
	const list = Array.isArray(rows) ? rows : [];
	let oldest = null;
	for (const row of list) {
		if (!row || typeof row !== "object") continue;
		const cid = Number(row.created_image_id ?? row.id);
		const at = row.created_at;
		if (!Number.isFinite(cid) || cid <= 0 || at == null || String(at).length === 0) continue;
		if (!oldest || feedRowIsStrictlyOlderThanCursor(row, oldest.created_at, oldest.created_image_id)) {
			oldest = { created_at: String(at), created_image_id: cid };
		}
	}
	if (!oldest) return null;
	return { created_at: oldest.created_at, created_image_id: oldest.created_image_id };
}

async function pullFeedTailAfterCursor(queries, userId, { limit, showOwnPosts, cursor }) {
	if (!cursor) return { rows: [], hasMore: false };
	if (typeof queries.selectFeedItems?.getPageAfterImageCursor === "function") {
		return queries.selectFeedItems.getPageAfterImageCursor(userId, {
			limit,
			includeOwnPosts: showOwnPosts,
			afterCreatedAt: cursor.created_at,
			afterCreatedImageId: cursor.created_image_id
		});
	}
	if (typeof queries.selectFeedItems?.all === "function") {
		const all = (await queries.selectFeedItems.all(userId, { includeOwnPosts: showOwnPosts })) ?? [];
		const older = all.filter((r) =>
			feedRowIsStrictlyOlderThanCursor(r, cursor.created_at, cursor.created_image_id)
		);
		const hasMore = older.length > limit;
		return { rows: older.slice(0, limit), hasMore };
	}
	return { rows: [], hasMore: false };
}

export async function pullMobileChatSlotPackFeedPageOne({
	queries,
	userId,
	limit,
	showOwnPosts,
	enableNsfw
}) {
	const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);

	if (typeof queries.selectFeedItems?.getLatestFeedSlotPackHead !== "function") {
		return pullCreationFeedRows({ queries, userId, limit: safeLimit, offset: 0, showOwnPosts });
	}

	const { videos: rawVideos, images: rawImages } =
		await queries.selectFeedItems.getLatestFeedSlotPackHead(userId, {
			videoLimit: MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT * MOBILE_CHAT_SPOTLIGHT_VIDEOS_PER_GROUP,
			imageLimit: MOBILE_CHAT_SPOTLIGHT_GROUP_COUNT * MOBILE_CHAT_BETWEEN_SPOTLIGHT_NONVIDEO_SLOTS,
			includeOwnPosts: showOwnPosts
		});

	if (rawVideos.length === 0 && rawImages.length === 0) {
		return pullCreationFeedRows({ queries, userId, limit: safeLimit, offset: 0, showOwnPosts });
	}

	const visible = (rows) =>
		enableNsfw ? rows : rows.filter((r) => !r.nsfw);
	const videos = visible(rawVideos);
	const images = visible(rawImages);

	const headRows = interleaveSlotPackHead(videos, images);

	const slotPackFeedCursor = latestCursorFromSlotPackHeadLists(videos, images);

	const tailSlots = Math.max(0, safeLimit - headRows.length);
	let tailRows = [];
	let tailHasMore = false;

	if (tailSlots > 0 && slotPackFeedCursor) {
		const tail = await pullFeedTailAfterCursor(queries, userId, {
			limit: tailSlots + 1,
			showOwnPosts,
			cursor: slotPackFeedCursor
		});
		tailRows = visible((tail.rows ?? []).slice(0, tailSlots));
		tailHasMore = Boolean(tail.hasMore);
	}

	const rows = [...headRows, ...tailRows];
	return {
		rows,
		hasMore: tailHasMore,
		isNewbieFeed: false,
		mobileChatSlotPackPageOne: true,
		slotPackFeedCursor
	};
}

export async function pullCreationFeedRowsAfterImageCursor({
	queries,
	userId,
	limit,
	showOwnPosts,
	afterCreatedAt,
	afterCreatedImageId
}) {
	const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
	const cursor = { created_at: String(afterCreatedAt ?? ""), created_image_id: afterCreatedImageId };

	const page = await pullFeedTailAfterCursor(queries, userId, {
		limit: safeLimit + 1,
		showOwnPosts,
		cursor
	});
	let rows = (page?.rows ?? []).slice(0, safeLimit);
	let hasMore = Boolean(page?.hasMore);

	if (rows.length === 0 && queries.selectExploreFeedItems) {
		const explorePaginated =
			queries.selectExploreFeedItems.paginated ?? queries.selectExploreFeedItems.getPage;
		if (typeof explorePaginated === "function") {
			const exploreResult = await explorePaginated(userId, { limit: safeLimit + 1, offset: 0 });
			const exploreRows = Array.isArray(exploreResult) ? exploreResult : (exploreResult?.rows ?? []);
			if (exploreRows.length > 0) {
				rows = exploreRows.slice(0, safeLimit);
				hasMore = exploreRows.length > safeLimit;
			}
		}
	}
	if (rows.length === 0 && queries.selectNewbieFeedItems) {
		const newbieRows = (await queries.selectNewbieFeedItems.all(userId)) ?? [];
		if (newbieRows.length > 0) {
			return {
				rows: newbieRows.slice(0, safeLimit),
				hasMore: newbieRows.length > safeLimit,
				isNewbieFeed: true,
				mobileChatSlotPackContinuation: true
			};
		}
	}
	if (rows.length === 0) {
		return pullCreationFeedRows({ queries, userId, limit: safeLimit, offset: 0, showOwnPosts });
	}
	const slotPackFeedCursor = oldestCreationCursorFromFeedRows(rows);
	return {
		rows,
		hasMore,
		isNewbieFeed: false,
		mobileChatSlotPackContinuation: true,
		slotPackFeedCursor
	};
}
