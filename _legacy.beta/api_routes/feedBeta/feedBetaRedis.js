import { Redis } from '@upstash/redis';

let redis = null;

export function isFeedBetaRedisConfigured() {
	if (process.env.JEST_WORKER_ID != null) return false;
	return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/** @returns {import('@upstash/redis').Redis|null} */
export function getFeedBetaRedis() {
	if (!isFeedBetaRedisConfigured()) return null;
	if (!redis) redis = Redis.fromEnv();
	return redis;
}
