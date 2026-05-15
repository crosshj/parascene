/**
 * Followed-feed pages containing only video creations (newest first). Used by doom scroll.
 */
export async function pullVideoFeedRows({ queries, userId, limit, offset, showOwnPosts }) {
	const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
	const safeOffset = Math.max(0, Number(offset) || 0);

	if (typeof queries.selectFeedItems?.getVideoFeedPage === "function") {
		const page = await queries.selectFeedItems.getVideoFeedPage(userId, {
			limit: safeLimit,
			offset: safeOffset,
			includeOwnPosts: showOwnPosts
		});
		return {
			rows: page?.rows ?? [],
			hasMore: Boolean(page?.hasMore),
			isNewbieFeed: false,
			videoFeedOnly: true
		};
	}

	/* Fallback: mixed feed page then filter (dev/mock without getVideoFeedPage). */
	if (typeof queries.selectFeedItems?.getPage === "function") {
		const page = await queries.selectFeedItems.getPage(userId, {
			limit: safeLimit * 4,
			offset: safeOffset,
			includeOwnPosts: showOwnPosts
		});
		const rows = (page?.rows ?? []).filter((row) => {
			const meta = row?.meta;
			return meta && typeof meta === "object" && meta.media_type === "video";
		});
		return {
			rows: rows.slice(0, safeLimit),
			hasMore: Boolean(page?.hasMore) || rows.length > safeLimit,
			isNewbieFeed: false,
			videoFeedOnly: true
		};
	}

	return { rows: [], hasMore: false, isNewbieFeed: false, videoFeedOnly: true };
}
