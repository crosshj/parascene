import { transformFeedCreationRow } from "./transformFeedCreationRow.js";
import { pullBlogFeedItems } from "./pullBlogFeedItems.js";
import {
	applyNewbieFeedTips,
	buildChallengeEngagementVirtualRows,
	injectEngagementIntoSlotPackHead,
	mergeEngagementIntoPage
} from "./engagementAndNewbie.js";

/**
 * Combine creation rows, NSFW filter, blog merge, challenge engagement card, newbie tips.
 *
 * Merge order:
 *   creation pulls → transform → NSFW → blog merge (offset 0) → challenge engagement (offset 0) → newbie tips
 */
export async function assembleFeedItems({
	queries,
	user,
	limit,
	offset,
	creationPull,
	challengeSnapshot,
	feedSurface = ""
}) {
	const enableNsfw = Boolean(user.meta && user.meta.enableNsfw === true);
	const { rows, hasMore, isNewbieFeed } = creationPull;
	const skipBlogMerge = Boolean(creationPull?.mobileChatSlotPackPageOne);
	const skipEngagement = Boolean(creationPull?.mobileChatSlotPackContinuation);
	const surface =
		typeof feedSurface === "string" ? feedSurface.trim().toLowerCase() : "";

	let itemsWithImages = rows.map(transformFeedCreationRow);
	if (!enableNsfw) {
		itemsWithImages = itemsWithImages.filter((item) => !item.nsfw);
	}

	if (offset === 0 && !skipBlogMerge) {
		const blogItems = await pullBlogFeedItems(queries, limit);
		if (blogItems.length > 0) {
			itemsWithImages = [...itemsWithImages, ...blogItems]
				.sort((a, b) =>
					String(b.created_at || "").localeCompare(String(a.created_at || ""))
				)
				.slice(0, limit);
		}
	}

	let engagementVirtual =
		offset === 0 &&
		!skipEngagement &&
		challengeSnapshot?.ok &&
		challengeSnapshot.active
			? buildChallengeEngagementVirtualRows(challengeSnapshot)
			: [];

	let listForEngagement = itemsWithImages;
	if (creationPull?.mobileChatSlotPackPageOne && engagementVirtual.length > 0) {
		listForEngagement = injectEngagementIntoSlotPackHead(itemsWithImages, engagementVirtual);
		engagementVirtual = [];
	}

	const pageAfterEngagement = mergeEngagementIntoPage(listForEngagement, engagementVirtual, {
		limit,
		feedSurface: surface
	});

	const items = applyNewbieFeedTips(pageAfterEngagement, isNewbieFeed);

	return { items, hasMore };
}
