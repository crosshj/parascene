import { pullChallengeFeedSnapshot } from './pullChallengeFeedSnapshot.js';
import {
	rebuildChallengeFeedSnapshotCache,
	invalidateChallengeFeedSnapshotMemCache
} from './challengeFeedSnapshotCache.js';
import { applyChallengeViewerOverlay } from './challengeFeedSnapshotShared.js';
import { buildChallengeEngagementVirtualRows } from './engagementAndNewbie.js';

/**
 * @param {object|null|undefined} snapshot
 * @returns {object|null}
 */
function challengeSnapshotToFeedItem(snapshot) {
	const rows = buildChallengeEngagementVirtualRows(snapshot);
	return rows.length > 0 ? rows[0] : null;
}

/**
 * One feed-shaped engagement row for the viewer, or null when nothing to show.
 *
 * @param {object} queries
 * @param {number} viewerUserId
 * @param {{ syncRebuildOnMiss?: boolean, fresh?: boolean }} [opts]
 * @returns {Promise<object|null>}
 */
export async function buildChallengeEngagementFeedItemForViewer(queries, viewerUserId, opts = {}) {
	// Default trusts cache; write-triggered invalidation keeps it fresh. Pass fresh:true to force rebuild.
	const fresh = opts.fresh === true;
	if (fresh) {
		invalidateChallengeFeedSnapshotMemCache();
		const rebuilt = await rebuildChallengeFeedSnapshotCache({ queries });
		if (rebuilt?.ok === true) {
			const snapshot = applyChallengeViewerOverlay(rebuilt, viewerUserId);
			return challengeSnapshotToFeedItem(snapshot) ?? null;
		}
	}

	const syncRebuildOnMiss = opts.syncRebuildOnMiss !== false;
	let snapshot = await pullChallengeFeedSnapshot({
		viewerUserId,
		queries
	});
	let item = challengeSnapshotToFeedItem(snapshot);
	if (item) return item;

	if (
		syncRebuildOnMiss &&
		(!snapshot?.ok || snapshot?.reason === 'cache_miss')
	) {
		const rebuilt = await rebuildChallengeFeedSnapshotCache({ queries });
		if (rebuilt?.ok === true) {
			snapshot = applyChallengeViewerOverlay(rebuilt, viewerUserId);
			item = challengeSnapshotToFeedItem(snapshot);
		}
	}

	return item ?? null;
}
