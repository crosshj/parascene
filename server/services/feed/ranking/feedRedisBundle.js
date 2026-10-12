import { getFeedRedis, isFeedRedisConfigured } from "../feedRedis.js";
import {
	FEED_CATALOG_REDIS_KEY,
	loadFeedCatalogSnapshotFromRedis
} from "./catalogSnapshot.js";
import {
	isFeedCatalogMemCacheFresh,
	primeFeedCatalogMemCache
} from "./catalogSnapshotCache.js";
import {
	CHALLENGE_FEED_SNAPSHOT_REDIS_KEY,
	isChallengeFeedSnapshotCachePayload,
	isChallengeFeedSnapshotMemCacheFresh,
	primeChallengeFeedSnapshotMemCache
} from "../challengeFeedSnapshotCache.js";
import {
	feedSeenKey,
	parseFeedSeenMembers,
	primeFeedSeenCache
} from "./seenRedis.js";

/**
 * One Upstash round-trip for catalog + challenge + seen when mem caches are cold.
 * @param {number|string} userId
 * @param {ReturnType<import('../feed/feedTiming.js').createFeedTiming>|null|undefined} [timing]
 * @param {{ includeChallenge?: boolean }} [opts]
 */
export async function primeFeedRedisFromPipeline(userId, timing = null, opts = {}) {
	if (!isFeedRedisConfigured() || userId == null) return;

	const includeChallenge = opts.includeChallenge !== false;
	const needCatalog = !isFeedCatalogMemCacheFresh();
	const needChallenge = includeChallenge && !isChallengeFeedSnapshotMemCacheFresh();
	if (!needCatalog && !needChallenge) {
		const r = getFeedRedis();
		if (!r) return;
		const t0 = performance.now();
		try {
			const members = await r.smembers(feedSeenKey(userId));
			primeFeedSeenCache(userId, parseFeedSeenMembers(members));
		} catch (err) {
			console.warn('[feed redisBundle] seen', err?.message || err);
		} finally {
			timing?.add('redis.seen', performance.now() - t0);
		}
		return;
	}

	const r = getFeedRedis();
	if (!r) return;

	const t0 = performance.now();
	try {
		const pipe = r.pipeline();
		const order = [];
		if (needCatalog) {
			pipe.get(FEED_CATALOG_REDIS_KEY);
			order.push('catalog');
		}
		if (needChallenge) {
			pipe.get(CHALLENGE_FEED_SNAPSHOT_REDIS_KEY);
			order.push('challenge');
		}
		pipe.smembers(feedSeenKey(userId));
		order.push('seen');

		const results = await pipe.exec();
		let idx = 0;
		if (needCatalog) {
			const raw = results[idx];
			idx += 1;
			if (raw && typeof raw === 'object' && raw.version === 1) {
				primeFeedCatalogMemCache(raw);
			}
		}
		if (needChallenge) {
			const raw = results[idx];
			idx += 1;
			if (isChallengeFeedSnapshotCachePayload(raw)) {
				primeChallengeFeedSnapshotMemCache(raw);
			}
		}
		const seenRaw = results[idx];
		primeFeedSeenCache(userId, parseFeedSeenMembers(seenRaw));

		timing?.add('redis.pipeline', performance.now() - t0, {
			keys: order.join(',')
		});
	} catch (err) {
		console.warn('[feed redisBundle] pipeline', err?.message || err);
		if (needCatalog) {
			try {
				const snapshot = await loadFeedCatalogSnapshotFromRedis();
				if (snapshot) primeFeedCatalogMemCache(snapshot);
			} catch {
				// fall through to per-key loaders in pull path
			}
		}
	}
}
