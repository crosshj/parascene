import { isFeedBetaPageCursor } from '../feedBeta/cursor.js';

/**
 * Feed [beta] page 1 for assembly (challenge card + blog merge on app Home).
 * @param {object} opts
 * @returns {boolean}
 */
export function isFeedBetaAssemblePageOne(opts) {
	const { useFeedBeta, creationPull, offset, hasImageCursor, feedBetaAck, afterAt, afterIdNum } =
		opts;
	if (!useFeedBeta || !creationPull) return false;
	if (creationPull.mobileChatSlotPackContinuation) return false;
	if (creationPull.mobileChatSlotPackPageOne) return true;
	const completed = Number(creationPull.feedBetaContinuation?.completed_page);
	if (completed === 1) return true;
	return (
		Number(offset) === 0 &&
		!hasImageCursor &&
		!feedBetaAck &&
		!isFeedBetaPageCursor(afterAt, afterIdNum)
	);
}

/**
 * @param {object} opts
 * @returns {{ includeBlogMerge: boolean, includeChallengeEngagement: boolean, fetchChallengeSnapshot: boolean }}
 */
export function resolveFeedAssembleOptions(opts) {
	const { useFeedBeta, offset, creationPull } = opts;
	const feedSurface =
		typeof opts.feedSurface === 'string' ? opts.feedSurface.trim().toLowerCase() : '';
	const isChatSurface = feedSurface === 'chat';
	const betaPageOne = isFeedBetaAssemblePageOne(opts);
	const legacyPageOne = !useFeedBeta && Number(offset) === 0;
	const pageOneForBlog = useFeedBeta ? betaPageOne : legacyPageOne;

	const pageOneAssembly =
		(betaPageOne || legacyPageOne) &&
		!Boolean(creationPull?.mobileChatSlotPackContinuation);

	return {
		includeBlogMerge:
			pageOneForBlog && !isChatSurface && !Boolean(creationPull?.mobileChatSlotPackPageOne),
		includeChallengeEngagement: pageOneAssembly && !isChatSurface,
		includeEditorialPin: pageOneAssembly,
		fetchChallengeSnapshot: (betaPageOne || legacyPageOne) && !isChatSurface
	};
}
