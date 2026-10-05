/**
 * Primary feed creation rows (followed → explore fallback → newbie fallback).
 * @param {{
 *   queries: object,
 *   userId: number,
 *   limit: number,
 *   offset: number,
 *   showOwnPosts: boolean
 * }} args
 */
export async function pullCreationFeedRows({
	queries,
	userId,
	limit,
	offset,
	showOwnPosts
}) {
	let rows;
	let hasMore = false;
	let isNewbieFeed = false;

	if (typeof queries.selectFeedItems?.getPage === "function") {
		const page = await queries.selectFeedItems.getPage(userId, {
			limit,
			offset,
			includeOwnPosts: showOwnPosts
		});
		rows = page?.rows ?? [];
		hasMore = Boolean(page?.hasMore);
	} else {
		const all =
			(await queries.selectFeedItems.all(userId, { includeOwnPosts: showOwnPosts })) ?? [];
		rows = all.slice(offset, offset + limit);
		hasMore = all.length > offset + limit;
	}

	if (rows.length === 0 && queries.selectExploreFeedItems) {
		const explorePaginated =
			queries.selectExploreFeedItems.paginated ?? queries.selectExploreFeedItems.getPage;
		if (typeof explorePaginated === "function") {
			const exploreLimit = limit + 1;
			const exploreResult = await explorePaginated(userId, {
				limit: exploreLimit,
				offset
			});
			const exploreRows = Array.isArray(exploreResult)
				? exploreResult
				: (exploreResult?.rows ?? []);
			if (exploreRows.length > 0) {
				rows = exploreRows.slice(0, limit);
				hasMore = exploreRows.length > limit;
			}
		}
	}

	if (rows.length === 0 && offset === 0 && queries.selectNewbieFeedItems) {
		const newbieRows = (await queries.selectNewbieFeedItems.all(userId)) ?? [];
		isNewbieFeed = true;
		rows = newbieRows.slice(0, limit);
		hasMore = newbieRows.length > limit;
	}

	return { rows, hasMore, isNewbieFeed };
}
