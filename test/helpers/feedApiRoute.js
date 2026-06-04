import { canAccessFeedBeta } from '../../api_routes/feedBeta/access.js';
import { pullFeedBetaRows } from '../../api_routes/feedBeta/pullFeedBetaRows.js';
import { pullCreationFeedRows } from '../../api_routes/feed/pullCreationFeedRows.js';
import { assembleFeedItems } from '../../api_routes/feed/assembleFeedItems.js';
import { pullChallengeFeedSnapshot } from '../../api_routes/feed/pullChallengeFeedSnapshot.js';
import { isFeedBetaPageCursor } from '../../api_routes/feedBeta/cursor.js';
import { parseFeedBetaAckFromQuery } from '../../api_routes/feedBeta/continuation.js';
import { resolveFeedAssembleOptions } from '../../api_routes/feed/resolveFeedAssemble.js';

/**
 * Mirrors GET /api/feed response assembly (api_routes/feed.js) for integration tests.
 * @param {object} opts
 * @param {object} opts.queries
 * @param {object} opts.user
 * @param {Record<string, string|number|boolean>} [opts.query]
 */
export async function buildGetFeedJsonResponse({ queries, user, query = {} }) {
	const limit = Math.min(Math.max(1, Number(query.limit) || 20), 100);
	const offset = Math.max(0, Number(query.offset) || 0);
	const showOwnPostsInFeed = Boolean(user.meta && user.meta.showOwnPostsInFeed === true);
	const slotPack = String(query.slot_pack || '').trim() === 'mobile_chat_v1';
	const afterAt = query.feed_after_image_created_at;
	const afterId = query.feed_after_image_id;
	const afterIdNum = Number.parseInt(String(afterId ?? ''), 10);
	const hasImageCursor =
		afterAt != null &&
		String(afterAt).length > 0 &&
		Number.isFinite(afterIdNum) &&
		afterIdNum > 0;

	const useFeedBeta = canAccessFeedBeta(user);
	const enableNsfw = Boolean(user.meta && user.meta.enableNsfw === true);
	const feedBetaAck = useFeedBeta ? parseFeedBetaAckFromQuery(query) : null;

	let creationPull;
	if (useFeedBeta) {
		const refreshBeta =
			String(query.refresh ?? '').trim() === '1' ||
			(offset === 0 && !hasImageCursor && (!slotPack || offset === 0) && !feedBetaAck);
		creationPull = await pullFeedBetaRows({
			queries,
			user,
			limit,
			offset,
			slotPack,
			afterAt: afterAt != null ? String(afterAt) : undefined,
			afterIdNum,
			enableNsfw,
			showOwnPosts: showOwnPostsInFeed,
			refresh: refreshBeta,
			feedBetaAck
		});
		const servedIds = creationPull?.feedBetaServedIds;
		if (Array.isArray(servedIds) && servedIds.length > 0 && queries.updateUserFeedBetaSeen?.run) {
			await queries.updateUserFeedBetaSeen.run(user.id, servedIds);
		}
	} else {
		creationPull = await pullCreationFeedRows({
			queries,
			userId: user.id,
			limit,
			offset,
			showOwnPosts: showOwnPostsInFeed
		});
	}

	const assembleOpts = resolveFeedAssembleOptions({
		useFeedBeta,
		offset,
		hasImageCursor,
		feedBetaAck,
		afterAt: afterAt != null ? String(afterAt) : undefined,
		afterIdNum,
		creationPull
	});

	let challengeSnapshot = { ok: false };
	if (assembleOpts.fetchChallengeSnapshot) {
		try {
			challengeSnapshot = await pullChallengeFeedSnapshot({
				viewerUserId: user.id,
				queries
			});
		} catch {
			challengeSnapshot = { ok: false };
		}
	}

	const feedSurface = String(query.feed_surface || '').trim();
	const { items, hasMore } = await assembleFeedItems({
		queries,
		user,
		limit,
		offset,
		creationPull,
		challengeSnapshot,
		feedSurface,
		includeBlogMerge: assembleOpts.includeBlogMerge,
		includeChallengeEngagement:
			assembleOpts.includeChallengeEngagement &&
			challengeSnapshot?.ok &&
			challengeSnapshot.active
	});

	const body = { items, hasMore };
	const betaCursor = creationPull?.feedBetaPageCursor ?? creationPull?.slotPackFeedCursor;
	if (betaCursor) {
		body.feed_cursor = {
			after_image_created_at: betaCursor.created_at,
			after_image_id: String(betaCursor.created_image_id)
		};
	}
	if (creationPull?.feedBetaContinuation) {
		body.feed_beta = creationPull.feedBetaContinuation;
	}
	return {
		body,
		useFeedBeta,
		creationPull,
		hasImageCursor: hasImageCursor || isFeedBetaPageCursor(afterAt, afterIdNum)
	};
}

/** Top-level keys always returned by GET /api/feed. */
export const FEED_API_TOP_LEVEL_KEYS = ['items', 'hasMore'];

/** Beta-only continuation fields (legacy feed omits these). */
export const FEED_BETA_API_TOP_LEVEL_KEYS = ['feed_cursor', 'feed_beta'];

/**
 * Common creation-card keys from transformFeedCreationRow (beta and legacy).
 */
export const FEED_CREATION_ITEM_KEYS = [
	'id',
	'title',
	'summary',
	'author',
	'created_at',
	'image_url',
	'thumbnail_url',
	'created_image_id',
	'user_id',
	'like_count',
	'comment_count',
	'viewer_liked',
	'nsfw',
	'media_type',
	'video_url'
];
