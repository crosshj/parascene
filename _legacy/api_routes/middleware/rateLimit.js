import { Redis } from "@upstash/redis";

let redis = null;
function getRedis() {
	if (!redis) redis = Redis.fromEnv();
	return redis;
}

function defaultIdentifier(req) {
	const userId = Number(req?.auth?.userId);
	if (Number.isFinite(userId) && userId > 0) return `u:${userId}`;
	const ip = req?.ip || req?.headers?.["x-forwarded-for"] || "unknown";
	return `ip:${String(ip).split(",")[0].trim() || "unknown"}`;
}

function resolveLimit(limit, req) {
	const n = typeof limit === "function" ? Number(limit(req)) : Number(limit);
	if (!Number.isFinite(n) || n <= 0) return null;
	return Math.floor(n);
}

function resolveClientIp(req) {
	return String(req?.ip || req?.headers?.["x-forwarded-for"] || "unknown")
		.split(",")[0]
		.trim() || "unknown";
}

async function ensureRateLimitWindowTtl(r, key, windowSec, current) {
	if (current === 1) {
		await r.expire(key, windowSec);
		return;
	}
	const ttlRaw = await r.ttl(key);
	const ttlNum = typeof ttlRaw === "number" ? ttlRaw : Number(ttlRaw);
	// Redis: -1 = key exists but has no expiry (e.g. failed EXPIRE after INCR). Without TTL the counter never resets.
	if (!Number.isFinite(ttlNum) || ttlNum === -1) {
		await r.expire(key, windowSec);
	}
}

/**
 * Basic fixed-window limiter backed by Upstash Redis.
 * Defaults to fail-open: if Redis check fails, request is allowed.
 */
function createRateLimitMiddleware({
	bucket,
	windowSec = 60,
	limit,
	methods = null,
	apiOnly = true,
	failOpen = true,
	identifier = defaultIdentifier,
	shouldApply = null
}) {
	const normalizedBucket = String(bucket || "global");
	const normalizedWindowSec = Number.isFinite(Number(windowSec)) ? Math.max(1, Math.floor(Number(windowSec))) : 60;
	const normalizedMethods = Array.isArray(methods)
		? new Set(methods.map((m) => String(m || "").toUpperCase()).filter(Boolean))
		: null;

	return async function rateLimitMiddleware(req, res, next) {
		if (apiOnly && !req.path.startsWith("/api/")) return next();
		if (normalizedMethods && !normalizedMethods.has(String(req.method || "").toUpperCase())) return next();
		if (typeof shouldApply === "function" && shouldApply(req) !== true) return next();

		const max = resolveLimit(limit, req);
		if (!Number.isFinite(max) || max <= 0) return next();

		try {
			const keyId = identifier(req);
			const key = `rl:${normalizedBucket}:${keyId}`;
			const r = getRedis();
			const current = Number(await r.incr(key));
			await ensureRateLimitWindowTtl(r, key, normalizedWindowSec, current);

			const remaining = Math.max(0, max - current);
			res.setHeader("X-RateLimit-Limit", String(max));
			res.setHeader("X-RateLimit-Remaining", String(remaining));

			if (current > max) {
				const ttlRaw = await r.ttl(key);
				const ttl = typeof ttlRaw === "number" ? ttlRaw : Number(ttlRaw);
				if (Number.isFinite(ttl) && ttl > 0) {
					res.setHeader("Retry-After", String(ttl));
				}
				console.warn("[rate-limit] blocked", {
					bucket: normalizedBucket,
					identifier: keyId,
					limit: max,
					current,
					ttl_sec_raw: Number.isFinite(ttl) ? ttl : ttlRaw ?? null,
					retry_after_sec: Number.isFinite(ttl) && ttl > 0 ? ttl : null,
					user_id: Number.isFinite(Number(req?.auth?.userId)) ? Number(req.auth.userId) : null,
					api_key_auth: req?.auth?.apiKeyAuth === true,
					integration_access: req?.auth?.integrationAccess === true,
					ip: resolveClientIp(req),
					method: String(req.method || "").toUpperCase(),
					path: req.path
				});
				return res.status(429).json({ error: "Too many requests", message: "Rate limit exceeded" });
			}
			return next();
		} catch (err) {
			console.error("[rate-limit] check failed", {
				bucket: normalizedBucket,
				method: String(req.method || "").toUpperCase(),
				path: req.path,
				fail_open: failOpen,
				error: err?.message || String(err)
			});
			if (!failOpen) {
				return res.status(503).json({ error: "Service unavailable", message: "Rate limiter unavailable" });
			}
			return next();
		}
	};
}

export { createRateLimitMiddleware };
