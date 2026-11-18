/**
 * Passive visitor activity (anonymous + authed) for bird's-eye analytics.
 * Piggybacks on existing requests. Redis down → the request still succeeds.
 */

import { pulseRedisConfigured, recordPulseToRedis, usEastDayKey } from "../../services/feed/visitPulse.js";

const localLastPulseMs = new Map();
const LOCAL_PULSE_MIN_MS = 60_000;
const LOCAL_MAP_MAX_KEYS = 10_000;

const SKIP_PATH_PREFIXES = [
	"/api/worker/",
	"/api/webhooks/",
	"/api/presence/",
	"/api/kiosk/"
];

/** Background polls — any HTTP method */
const SKIP_PATH_EXACT = new Set([
	"/api/chat/unread-summary",
	"/api/notifications/unread-count"
]);

/** Nav / sidebar session chrome (GET only; PUT/PATCH still pulse) */
const SKIP_PATH_GET_ONLY = new Set([
	"/api/profile",
	"/api/credits",
	"/api/notifications"
]);

const SKIP_STATIC_EXT = new Set([
	".js",
	".css",
	".map",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".svg",
	".ico",
	".woff",
	".woff2",
	".ttf",
	".eot",
	".mp4",
	".webm"
]);

let warnedMissingRedis = false;

function pruneLocalMapIfNeeded() {
	if (localLastPulseMs.size <= LOCAL_MAP_MAX_KEYS) return;
	const overflow = localLastPulseMs.size - LOCAL_MAP_MAX_KEYS;
	const keys = localLastPulseMs.keys();
	for (let i = 0; i < overflow; i++) {
		const { value: k, done } = keys.next();
		if (done) break;
		localLastPulseMs.delete(k);
	}
}

function shouldSkipRequest(req) {
	const p = String(req.path || "");
	const method = String(req.method || "GET").toUpperCase();
	if (method === "OPTIONS") return true;
	for (const prefix of SKIP_PATH_PREFIXES) {
		if (p.startsWith(prefix)) return true;
	}
	if (SKIP_PATH_EXACT.has(p)) return true;
	if (method === "GET" && SKIP_PATH_GET_ONLY.has(p)) return true;
	const dot = p.lastIndexOf(".");
	if (dot !== -1) {
		const ext = p.slice(dot).toLowerCase();
		if (SKIP_STATIC_EXT.has(ext)) return true;
	}
	return false;
}

function resolveVisitorKey(req) {
	const userId = Number(req?.auth?.userId);
	if (Number.isFinite(userId) && userId > 0) return `u:${userId}`;
	const cid =
		typeof req?.clientId === "string"
			? req.clientId.trim()
			: typeof req?.cookies?.prsn_cid === "string"
				? req.cookies.prsn_cid.trim()
				: "";
	if (cid) return `v:${cid}`;
	return null;
}

function shouldPulseLocally(visitorKey, nowMs) {
	const last = localLastPulseMs.get(visitorKey);
	if (Number.isFinite(last) && nowMs - last < LOCAL_PULSE_MIN_MS) return false;
	localLastPulseMs.set(visitorKey, nowMs);
	pruneLocalMapIfNeeded();
	return true;
}

function noteRedisFailure(err) {
	if (!pulseRedisConfigured()) {
		if (!warnedMissingRedis) {
			warnedMissingRedis = true;
			console.warn("[visit-pulse] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is unset; pulses are not recorded");
		}
		return;
	}
	console.warn("[visit-pulse] redis", err?.message || err);
}

/**
 * @param {{ failOpen?: boolean, recordPulse?: typeof recordPulseToRedis, dayKeyFor?: typeof usEastDayKey, now?: () => number }} [options]
 */
export function createVisitPulseMiddleware(options = {}) {
	const failOpen = options.failOpen !== false;
	const recordPulse = options.recordPulse || recordPulseToRedis;
	const dayKeyFor = options.dayKeyFor || usEastDayKey;
	const now = options.now || Date.now;

	return function visitPulseMiddleware(req, res, next) {
		if (shouldSkipRequest(req)) return next();

		const visitorKey = resolveVisitorKey(req);
		if (!visitorKey) return next();

		const nowMs = now();
		if (!shouldPulseLocally(visitorKey, nowMs)) return next();

		const dayKey = dayKeyFor(new Date(nowMs));
		void Promise.resolve(recordPulse(visitorKey, nowMs, dayKey)).catch((err) => {
			if (failOpen) noteRedisFailure(err);
			else console.warn("[visit-pulse] redis", err?.message || err);
		});

		return next();
	};
}
