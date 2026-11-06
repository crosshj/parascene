import { canAccessFeedBeta } from '../../api_routes/feedBeta/access.js';
import { pullFeedBetaRows } from '../../api_routes/feedBeta/pullFeedBetaRows.js';
import { pullCreationFeedRows } from '../../api_routes/feed/pullCreationFeedRows.js';
import { assembleFeedItems } from '../../api_routes/feed/assembleFeedItems.js';
import { pullChallengeFeedSnapshot } from '../../api_routes/feed/pullChallengeFeedSnapshot.js';
import { isFeedBetaPageCursor } from '../../api_routes/feedBeta/cursor.js';
import { parseFeedBetaAckFromQuery } from '../../api_routes/feedBeta/continuation.js';
import { resolveFeedAssembleOptions } from '../../api_routes/feed/resolveFeedAssemble.js';
import { createFeedTiming, wrapTimedPromise } from '../../api_routes/feed/feedTiming.js';
import { primeFeedBetaRedisFromPipeline } from '../../api_routes/feedBeta/feedBetaRedisBundle.js';

/**
 * Mirrors GET /api/feed response assembly (api_routes/feed.js) for integration tests.
 * @param {object} opts
 * @param {object} opts.queries
 * @param {object} opts.user
 * @param {Record<string, string|number|boolean>} [opts.query]
 */
export async function buildGetFeedJsonResponse({ queries, user, query = {}, requestT0 = performance.now() }) {
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
	const userLoadStart = performance.now();
	const timing = useFeedBeta ? createFeedTiming(requestT0) : null;
	timing?.add('pre_handler', userLoadStart - requestT0);
	const enableNsfw = Boolean(user.meta && user.meta.enableNsfw === true);
	const feedBetaAck = useFeedBeta ? parseFeedBetaAckFromQuery(query) : null;
	const feedSurface = String(query.feed_surface || '').trim();
	const isChatSurface = feedSurface.toLowerCase() === 'chat';

	let creationPull;
	let challengeSnapshot = { ok: false };
	if (useFeedBeta) {
		await primeFeedBetaRedisFromPipeline(user.id, timing, {
			includeChallenge: !isChatSurface
		});
		const refreshBeta =
			String(query.refresh ?? '').trim() === '1' ||
			(offset === 0 && !hasImageCursor && (!slotPack || offset === 0) && !feedBetaAck);
		const likelyAssemblyPageOne = offset === 0 && !hasImageCursor && !feedBetaAck;
		const pullChallengePromise =
			likelyAssemblyPageOne && !isChatSurface
				? wrapTimedPromise(
						timing,
						'challenge_snapshot',
						pullChallengeFeedSnapshot({ viewerUserId: user.id, queries }).catch(() => ({
							ok: false
						}))
					)
				: Promise.resolve({ ok: false });
		const pullRowsPromise = wrapTimedPromise(
			timing,
			'pull.rows_total',
			pullFeedBetaRows({
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
				feedBetaAck,
				timing
			})
		);
		const [pull, challenge] = await Promise.all([pullRowsPromise, pullChallengePromise]);
		creationPull = pull;
		challengeSnapshot = challenge;
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
		creationPull,
		feedSurface
	});

	if (!useFeedBeta && assembleOpts.fetchChallengeSnapshot) {
		try {
			challengeSnapshot = await pullChallengeFeedSnapshot({
				viewerUserId: user.id,
				queries
			});
		} catch {
			challengeSnapshot = { ok: false };
		}
	}

	const { items, hasMore } = await (timing
		? timing.timeAsync('assemble.total', () =>
				assembleFeedItems({
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
						challengeSnapshot.active,
					includeEditorialPin: assembleOpts.includeEditorialPin,
					timing
				})
			)
		: assembleFeedItems({
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
					challengeSnapshot.active,
				includeEditorialPin: assembleOpts.includeEditorialPin
			}));

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
	if (timing) {
		const meta = creationPull?.feedBetaTimingMeta ?? {};
		timing.time('handler.json_stringify', () =>
			JSON.stringify({
				...body,
				feed_timing: { total_ms: 0, server_handler_ms: 0, segments: {} }
			})
		);
		body.feed_timing = timing.finish({
			page_index: meta.pageIndex ?? null,
			slot_pack_page_one: meta.slotPackPageOne === true,
			catalog_from_snapshot: meta.fromSnapshot === true,
			catalog_size: meta.catalogSize ?? null,
			row_count: meta.rowCount ?? items.length,
			pre_handler_includes:
				'session lookup, rate limits, and other middleware before the feed route handler',
			client_network_hint:
				'Browser Network duration also includes TLS/RTT and downloading the response body; compare Network time minus server_handler_ms.'
		});
		body.feed_timing.response_bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
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
export const FEED_BETA_API_TOP_LEVEL_KEYS = ['feed_cursor', 'feed_beta', 'feed_timing'];

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
