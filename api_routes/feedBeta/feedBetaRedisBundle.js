import { getFeedBetaRedis, isFeedBetaRedisConfigured } from './feedBetaRedis.js';
import {
	FEED_BETA_CATALOG_REDIS_KEY,
	loadFeedBetaCatalogSnapshotFromRedis
} from './catalogSnapshot.js';
import {
	isFeedBetaCatalogMemCacheFresh,
	primeFeedBetaCatalogMemCache
} from './catalogSnapshotCache.js';
import {
	CHALLENGE_FEED_SNAPSHOT_REDIS_KEY,
	isChallengeFeedSnapshotMemCacheFresh,
	primeChallengeFeedSnapshotMemCache
} from '../feed/challengeFeedSnapshotCache.js';
import {
	feedBetaSeenKey,
	parseFeedBetaSeenMembers,
	primeFeedBetaSeenCache
} from './seenRedis.js';

/**
 * One Upstash round-trip for catalog + challenge + seen when mem caches are cold.
 * @param {number|string} userId
 * @param {ReturnType<import('../feed/feedTiming.js').createFeedTiming>|null|undefined} [timing]
 * @param {{ includeChallenge?: boolean }} [opts]
 */
export async function primeFeedBetaRedisFromPipeline(userId, timing = null, opts = {}) {
	if (!isFeedBetaRedisConfigured() || userId == null) return;

	const includeChallenge = opts.includeChallenge !== false;
	const needCatalog = !isFeedBetaCatalogMemCacheFresh();
	const needChallenge = includeChallenge && !isChallengeFeedSnapshotMemCacheFresh();
	if (!needCatalog && !needChallenge) {
		const r = getFeedBetaRedis();
		if (!r) return;
		const t0 = performance.now();
		try {
			const members = await r.smembers(feedBetaSeenKey(userId));
			primeFeedBetaSeenCache(userId, parseFeedBetaSeenMembers(members));
		} catch (err) {
			console.warn('[feedBeta redisBundle] seen', err?.message || err);
		} finally {
			timing?.add('redis.seen', performance.now() - t0);
		}
		return;
	}

	const r = getFeedBetaRedis();
	if (!r) return;

	const t0 = performance.now();
	try {
		const pipe = r.pipeline();
		const order = [];
		if (needCatalog) {
			pipe.get(FEED_BETA_CATALOG_REDIS_KEY);
			order.push('catalog');
		}
		if (needChallenge) {
			pipe.get(CHALLENGE_FEED_SNAPSHOT_REDIS_KEY);
			order.push('challenge');
		}
		pipe.smembers(feedBetaSeenKey(userId));
		order.push('seen');

		const results = await pipe.exec();
		let idx = 0;
		if (needCatalog) {
			const raw = results[idx];
			idx += 1;
			if (raw && typeof raw === 'object' && raw.version === 1) {
				primeFeedBetaCatalogMemCache(raw);
			}
		}
		if (needChallenge) {
			const raw = results[idx];
			idx += 1;
			if (raw && typeof raw === 'object' && raw.version === 1) {
				primeChallengeFeedSnapshotMemCache(raw);
			}
		}
		const seenRaw = results[idx];
		primeFeedBetaSeenCache(userId, parseFeedBetaSeenMembers(seenRaw));

		timing?.add('redis.pipeline', performance.now() - t0, {
			keys: order.join(',')
		});
	} catch (err) {
		console.warn('[feedBeta redisBundle] pipeline', err?.message || err);
		if (needCatalog) {
			try {
				const snapshot = await loadFeedBetaCatalogSnapshotFromRedis();
				if (snapshot) primeFeedBetaCatalogMemCache(snapshot);
			} catch {
				// fall through to per-key loaders in pull path
			}
		}
	}
}
