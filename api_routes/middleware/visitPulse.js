/**
 * Visit pulse — passive visitor activity (anonymous + authed), bird's-eye analytics.
 *
 * Design goals (notes)
 * - passive: no new client beacons; piggyback on existing Express traffic only
 * - everyone: anonymous via prsn_cid (v:), logged-in via user id (u:)
 * - timeline: 15-min blocks on US East day grid; range endpoints stored as UTC ISO
 * - bird's-eye: one DB row per US East calendar day (summary cols + details.visitors[].ranges)
 * - flush at US East EOD → yesterday US East partition (union ranges; safe re-flush)
 * - vercel-friendly: warm lambda Map throttles Redis; Redis merge + nightly flush to DB
 * - low chatter: skip static, workers, webhooks, poll routes
 * - fail-open: Redis down → request still succeeds
 * - consume: scripts/analytics/visit-pulse-report.cjs (--live for Redis today)
 *
 * Redis keys
 * - pulse:day:{date}:{visitorKey}     HASH first_seen, last_seen, hits
 * - pulse:blocks:{date}:{visitorKey}  SET of 15-min block indices (0..95)
 * - pulse:active                      ZSET ~10m TTL
 * - pulse:dedupe:{visitorKey}         SET NX 90s
 */

export {
	PULSE_ACTIVE_KEY,
	PULSE_DAY_TTL_SEC,
	pulseDayHashKey,
	pulseDayScanPattern,
	pulseBlocksSetKey,
	usEastDayKey,
	recordPulseToRedis,
	buildDaySnapshotFromRedis,
	mergeBlockIndicesToRanges,
	parseVisitorKey,
	PULSE_BLOCK_MINUTES,
	PULSE_BLOCKS_PER_DAY
} from "../utils/visitPulseCore.js";

import { recordPulseToRedis, usEastDayKey } from "../utils/visitPulseCore.js";

const localLastPulseMs = new Map();
const LOCAL_PULSE_MIN_MS = 60_000;
const LOCAL_MAP_MAX_KEYS = 10_000;

const SKIP_PATH_PREFIXES = ["/api/worker/", "/api/webhooks/"];

const SKIP_PATH_EXACT = new Set([
	"/api/chat/unread-summary",
	"/api/presence/online",
	"/api/presence/last-active",
	"/api/notifications/unread-count"
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
	if (req.method === "OPTIONS") return true;
	for (const prefix of SKIP_PATH_PREFIXES) {
		if (p.startsWith(prefix)) return true;
	}
	if (SKIP_PATH_EXACT.has(p)) return true;
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

/**
 * @param {{ failOpen?: boolean }} [options]
 */
export function createVisitPulseMiddleware(options = {}) {
	const failOpen = options.failOpen !== false;

	return function visitPulseMiddleware(req, res, next) {
		if (shouldSkipRequest(req)) return next();

		const visitorKey = resolveVisitorKey(req);
		if (!visitorKey) return next();

		const nowMs = Date.now();
		if (!shouldPulseLocally(visitorKey, nowMs)) return next();

		const dayKey = usEastDayKey(new Date(nowMs));
		void recordPulseToRedis(visitorKey, nowMs, dayKey).catch((err) => {
			if (!failOpen) {
				console.warn("[visit-pulse] redis", err?.message || err);
			}
		});

		return next();
	};
}
