import { buildFeedBetaCatalogSnapshot, saveFeedBetaCatalogSnapshotToRedis } from './catalogSnapshot.js';
import { invalidateFeedBetaCatalogMemCache } from './catalogSnapshotCache.js';
import { rebuildChallengeFeedSnapshotCache } from '../feed/challengeFeedSnapshotCache.js';

/**
 * Rebuild shared feed beta catalog snapshot → Redis (all users read this).
 *
 * @param {{ queries: object, args?: object }} opts
 */
export async function runFeedBetaCatalogRebuild({ queries, args = {} } = {}) {
	void args;
	const snapshot = await buildFeedBetaCatalogSnapshot(queries);
	if (!snapshot) {
		throw new Error('buildFeedBetaCatalogSnapshot returned null');
	}

	const saved = await saveFeedBetaCatalogSnapshotToRedis(snapshot);
	if (!saved) {
		throw new Error('Redis not configured or catalog save failed');
	}
	invalidateFeedBetaCatalogMemCache();

	const challengeShared = await rebuildChallengeFeedSnapshotCache({ queries });

	const mergedCount = new Set(
		[...snapshot.recent, ...snapshot.hot, ...snapshot.back_pool, ...snapshot.video_head]
			.map((row) => row?.created_image_id)
			.filter((id) => id != null)
	).size;

	return {
		ok: true,
		built_at: snapshot.built_at,
		recent: snapshot.recent.length,
		hot: snapshot.hot.length,
		back_pool: snapshot.back_pool.length,
		video_head: snapshot.video_head.length,
		unique_creations: mergedCount,
		published_count: snapshot.published_count,
		challenge_snapshot: challengeShared?.ok === true,
		challenge_submissions: Array.isArray(challengeShared?.submissions)
			? challengeShared.submissions.length
			: 0
	};
}
