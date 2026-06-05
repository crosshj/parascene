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
	includeEditorialPin,
	timing = null
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
	const doEditorialPin =
		includeEditorialPin === true ||
		(includeEditorialPin !== false &&
			Number(offset) === 0 &&
			!skipEngagement);

	const blogPromise = doBlogMerge
		? (timing
				? timing.timeAsync('assemble.blog', () => pullBlogFeedItems(queries, limit))
				: pullBlogFeedItems(queries, limit))
		: Promise.resolve([]);
	const pinPromise = doEditorialPin
		? (timing
				? timing.timeAsync('assemble.editorial_pin', () =>
						buildEditorialPinFeedItems(queries, { enableNsfw, feedSurface: surface })
					)
				: buildEditorialPinFeedItems(queries, { enableNsfw, feedSurface: surface }))
		: Promise.resolve({ items: [], pins: [], defaults: {} });

	let itemsWithImages = timing
		? timing.time('assemble.transform', () => rows.map(transformFeedCreationRow))
		: rows.map(transformFeedCreationRow);
	if (!enableNsfw) {
		itemsWithImages = itemsWithImages.filter((item) => !item.nsfw);
	}

	const blogItems = await blogPromise;
	if (doBlogMerge && blogItems.length > 0) {
		itemsWithImages = [...itemsWithImages, ...blogItems]
			.sort((a, b) =>
				String(b.created_at || "").localeCompare(String(a.created_at || ""))
			)
			.slice(0, limit);
	}

	let engagementVirtual =
		doChallengeEngagement &&
		challengeSnapshot?.ok &&
		challengeSnapshot.active
			? (timing
					? timing.time('assemble.challenge_card', () =>
							buildChallengeEngagementVirtualRows(challengeSnapshot)
						)
					: buildChallengeEngagementVirtualRows(challengeSnapshot))
			: [];

	let listForEngagement = itemsWithImages;
	if (creationPull?.mobileChatSlotPackPageOne && engagementVirtual.length > 0) {
		listForEngagement = timing
			? timing.time('assemble.slot_pack_engagement', () =>
					injectEngagementIntoSlotPackHead(itemsWithImages, engagementVirtual)
				)
			: injectEngagementIntoSlotPackHead(itemsWithImages, engagementVirtual);
		engagementVirtual = [];
	}

	const pageAfterEngagement = timing
		? timing.time('assemble.merge_engagement', () =>
				mergeEngagementIntoPage(listForEngagement, engagementVirtual, {
					limit,
					feedSurface: surface
				})
			)
		: mergeEngagementIntoPage(listForEngagement, engagementVirtual, {
				limit,
				feedSurface: surface
			});

	let pageAfterPin = pageAfterEngagement;
	if (doEditorialPin) {
		const { items: pinItems, pins: pinConfigs, defaults: pinDefaults } = await pinPromise;
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
