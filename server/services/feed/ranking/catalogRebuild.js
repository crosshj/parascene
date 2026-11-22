import { rebuildChallengeFeedSnapshotCache } from "../challengeFeedSnapshotCache.js";
import { invalidateFeedCatalogMemCache } from "./catalogSnapshotCache.js";
import { buildFeedCatalogSnapshot, saveFeedCatalogSnapshotToRedis } from "./catalogSnapshot.js";

export async function runFeedCatalogRebuild({ queries }) {
	const snapshot = await buildFeedCatalogSnapshot(queries);
	if (!snapshot) throw new Error("buildFeedCatalogSnapshot returned null");
	const saved = await saveFeedCatalogSnapshotToRedis(snapshot);
	if (!saved) throw new Error("Redis not configured or catalog save failed");
	invalidateFeedCatalogMemCache();
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
		challenge_submissions: Array.isArray(challengeShared?.submissions) ? challengeShared.submissions.length : 0
	};
}
