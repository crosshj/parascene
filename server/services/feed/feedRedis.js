import { Redis } from '@upstash/redis';

let redis = null;

export function isFeedRedisConfigured() {
	if (process.env.JEST_WORKER_ID != null) return false;
	return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/** @returns {import('@upstash/redis').Redis|null} */
export function getFeedRedis() {
	if (!isFeedRedisConfigured()) return null;
	if (!redis) redis = Redis.fromEnv();
	return redis;
}
