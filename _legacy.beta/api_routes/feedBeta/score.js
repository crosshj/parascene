import { FEED_BETA_DEFAULT_PARAMS } from './params.js';
import { rowMentionsNewcomerHandle } from './context.js';

/**
 * @param {object} row
 * @param {object} ctx
 * @returns {{ score: number, engagement: number, ageHours: number, inHot24: boolean, inHot7: boolean, isNewPublish: boolean, isNewcomer: boolean, isFollow: boolean }}
 */
export function scoreFeedBetaRow(row, ctx) {
	const params = ctx.params ?? FEED_BETA_DEFAULT_PARAMS;
	const nowMs = Number(ctx.nowMs) || Date.now();
	const createdMs = Date.parse(String(row?.created_at ?? ''));
	const ageHours = Number.isFinite(createdMs)
		? Math.max(0, (nowMs - createdMs) / (60 * 60 * 1000))
		: 9999;

	const likes = Number(row?.like_count ?? 0);
	const comments = Number(row?.comment_count ?? 0);
	const engagement = Math.log1p(likes * 2 + comments * 3);

	const inHot24 = ageHours <= 24;
	const inHot7 = ageHours <= params.hotWindowHours;
	const isNewPublish = ageHours <= params.newPublishMaxHours;

	const freshness = Math.exp(-ageHours / Math.max(1, params.freshHalfLifeHours));
	let score =
		freshness * params.freshnessWeight +
		engagement * params.engagementWeight * (inHot7 ? 1.25 : 0.65);

	const authorId = row?.user_id != null ? String(row.user_id) : '';
	const isFollow = authorId && ctx.followingIds instanceof Set && ctx.followingIds.has(authorId);
	const isNewcomerAuthor =
		authorId && ctx.newcomerAuthorIds instanceof Set && ctx.newcomerAuthorIds.has(authorId);
	const mentionsNewcomer = rowMentionsNewcomerHandle(row, ctx.newcomerHandles);

	if (isFollow) score *= params.followAuthorMultiplier;
	if (isNewcomerAuthor) score *= params.newcomerAuthorMultiplier;
	else if (mentionsNewcomer) score *= params.newcomerMentionMultiplier;

	return {
		score,
		engagement,
		ageHours,
		inHot24,
		inHot7,
		isNewPublish,
		isNewcomer: isNewcomerAuthor || mentionsNewcomer,
		isNewcomerAuthor: Boolean(isNewcomerAuthor),
		mentionsNewcomer: Boolean(mentionsNewcomer),
		isFollow: Boolean(isFollow)
	};
}
