import { transformFeedCreationRow } from "./transformFeedCreationRow.js";
import { pullBlogFeedItems } from "./pullBlogFeedItems.js";
import {
	applyNewbieFeedTips,
	buildChallengeEngagementVirtualRows,
	injectEngagementIntoSlotPackHead,
	mergeEngagementIntoPage
} from "./engagementAndNewbie.js";
import {
	buildEditorialPinFeedItems,
	mergeEditorialPinIntoPage
} from "./editorialPin.js";

/**
 * Combine creation rows, NSFW filter, blog merge, challenge engagement card, editorial pin, newbie tips.
 *
 * Merge order:
 *   creation pulls → transform → NSFW → blog merge (offset 0) → challenge engagement (offset 0)
 *   → editorial pin (page 1) → newbie tips
 */
export async function assembleFeedItems({
	queries,
	user,
	limit,
	offset,
	creationPull,
	challengeSnapshot,
	feedSurface = "",
	includeBlogMerge,
	includeChallengeEngagement,
	includeEditorialPin
}) {
	const enableNsfw = Boolean(user.meta && user.meta.enableNsfw === true);
	const { rows, hasMore, isNewbieFeed } = creationPull;
	const skipBlogMerge = Boolean(creationPull?.mobileChatSlotPackPageOne);
	const skipEngagement = Boolean(creationPull?.mobileChatSlotPackContinuation);
	const surface =
		typeof feedSurface === "string" ? feedSurface.trim().toLowerCase() : "";

	const doBlogMerge =
		includeBlogMerge === true ||
		(includeBlogMerge !== false && offset === 0 && !skipBlogMerge);
	const doChallengeEngagement =
		includeChallengeEngagement === true ||
		(includeChallengeEngagement !== false &&
			offset === 0 &&
			!skipEngagement);

	let itemsWithImages = rows.map(transformFeedCreationRow);
	if (!enableNsfw) {
		itemsWithImages = itemsWithImages.filter((item) => !item.nsfw);
	}

	if (doBlogMerge) {
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
		doChallengeEngagement &&
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

	const doEditorialPin =
		includeEditorialPin === true ||
		(includeEditorialPin !== false &&
			Number(offset) === 0 &&
			!skipEngagement);

	let pageAfterPin = pageAfterEngagement;
	if (doEditorialPin) {
		const { items: pinItems, pins: pinConfigs, defaults: pinDefaults } =
			await buildEditorialPinFeedItems(queries, {
				enableNsfw,
				feedSurface: surface
			});
		for (let i = 0; i < pinItems.length; i += 1) {
			pageAfterPin = mergeEditorialPinIntoPage(
				pageAfterPin,
				pinItems[i],
				pinConfigs[i],
				pinDefaults,
				{
					limit,
					slotPackPageOne: Boolean(creationPull?.mobileChatSlotPackPageOne)
				}
			);
		}
	}

	const items = applyNewbieFeedTips(pageAfterPin, isNewbieFeed);

	return { items, hasMore };
}
