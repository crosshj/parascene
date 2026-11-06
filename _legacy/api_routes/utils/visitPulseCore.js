/**
 * Shared visit-pulse logic (Redis keys, 15-min blocks, Redis read).
 * Redis key + DB `day`: US East calendar date (UTC-5, no DST).
 * Timestamps in hashes and details.ranges: UTC ISO.
 * Flush cron: 00:10 US East (05:10 UTC) → yesterday US East partition.
 */

import { Redis } from "@upstash/redis";

export const PULSE_BLOCK_MINUTES = 15;
export const PULSE_BLOCKS_PER_DAY = (24 * 60) / PULSE_BLOCK_MINUTES;

/** `pulse:day:{date}:…` and DB `day` column — US Eastern calendar date, fixed UTC-5. */
export const PULSE_DAY_PARTITION_LABEL = "US East (UTC-5, no DST)";
/** first_seen, last_seen, range endpoints. */
export const PULSE_TIMESTAMPS_TZ = "UTC";
export const PULSE_US_EAST_UTC_OFFSET_HOURS = 5;
export const PULSE_US_EAST_OFFSET_MS = PULSE_US_EAST_UTC_OFFSET_HOURS * 60 * 60 * 1000;

export const PULSE_FLUSH_CRON_UTC = "10 5 * * *";
export const PULSE_FLUSH_TRIGGER_LABEL =
	"00:10 US East (UTC-5, no DST) → flush yesterday US East partition";

export const PULSE_ACTIVE_KEY = "pulse:active";
export const PULSE_DAY_TTL_SEC = 72 * 60 * 60;
export const PULSE_ACTIVE_TTL_SEC = 10 * 60;
export const PULSE_DEDUPE_TTL_SEC = 90;
export const PULSE_DETAILS_VERSION = 2;

/** @param {string} dayKey YYYY-MM-DD */
export function pulseDayHashKey(dayKey, visitorKey) {
	return `pulse:day:${dayKey}:${visitorKey}`;
}

/** @param {string} dayKey YYYY-MM-DD */
export function pulseBlocksSetKey(dayKey, visitorKey) {
	return `pulse:blocks:${dayKey}:${visitorKey}`;
}

/** @param {string} dayKey YYYY-MM-DD */
export function pulseDayScanPattern(dayKey) {
	return `pulse:day:${dayKey}:*`;
}

export function pulseDedupeKey(visitorKey) {
	return `pulse:dedupe:${visitorKey}`;
}

/** US East calendar date YYYY-MM-DD (fixed UTC-5) — Redis + DB partition. */
export function usEastDayKey(date = new Date()) {
	const shifted = new Date(date.getTime() - PULSE_US_EAST_OFFSET_MS);
	const y = shifted.getUTCFullYear();
	const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
	const d = String(shifted.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/** Midnight US East for partition dayKey → UTC epoch ms. */
export function usEastDayStartMs(dayKey) {
	const parts = String(dayKey || "")
		.trim()
		.split("-")
		.map((x) => Number(x));
	const [y, m, d] = parts;
	if (!y || !m || !d) throw new Error(`usEastDayStartMs: invalid dayKey ${dayKey}`);
	return Date.UTC(y, m - 1, d, PULSE_US_EAST_UTC_OFFSET_HOURS, 0, 0, 0);
}

/** 15-minute block index 0..95 within a US East partition day. */
export function pulseBlockIndexForDay(dayKey, nowMs) {
	const dayStart = usEastDayStartMs(dayKey);
	const offset = nowMs - dayStart;
	if (!Number.isFinite(offset) || offset < 0) return 0;
	const idx = Math.floor(offset / (PULSE_BLOCK_MINUTES * 60 * 1000));
	return Math.min(PULSE_BLOCKS_PER_DAY - 1, Math.max(0, idx));
}

/** @param {string} dayKey US East partition @param {number} blockIndex */
export function blockIndexToRangeIso(dayKey, blockIndex) {
	const startMs = usEastDayStartMs(dayKey) + blockIndex * PULSE_BLOCK_MINUTES * 60 * 1000;
	const endMs = startMs + PULSE_BLOCK_MINUTES * 60 * 1000;
	return [new Date(startMs).toISOString(), new Date(endMs).toISOString()];
}

/** @param {string} dayKey @param {number[]} indices */
export function mergeBlockIndicesToRanges(dayKey, indices) {
	const sorted = [
		...new Set(
			(indices || [])
				.map((x) => Number(x))
				.filter((n) => Number.isFinite(n) && n >= 0 && n < PULSE_BLOCKS_PER_DAY)
		)
	].sort((a, b) => a - b);
	if (!sorted.length) return [];

	const ranges = [];
	let runStart = sorted[0];
	let runEnd = sorted[0];
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i] === runEnd + 1) {
			runEnd = sorted[i];
		} else {
			ranges.push([
				blockIndexToRangeIso(dayKey, runStart)[0],
				blockIndexToRangeIso(dayKey, runEnd)[1]
			]);
			runStart = sorted[i];
			runEnd = sorted[i];
		}
	}
	ranges.push([
		blockIndexToRangeIso(dayKey, runStart)[0],
		blockIndexToRangeIso(dayKey, runEnd)[1]
	]);
	return ranges;
}

/** @param {string} dayKey @param {Array<object>} visitors */
export function buildSnapshotFromVisitors(dayKey, visitors, meta = {}) {
	const list = Array.isArray(visitors) ? visitors : [];
	const authed = list.filter((v) => parseVisitorKey(v.visitor_key).kind === "user").length;
	const anon = list.filter((v) => parseVisitorKey(v.visitor_key).kind === "anon").length;
	return {
		day: dayKey,
		unique_visitors: list.length,
		authed_visitors: authed,
		anon_visitors: anon,
		total_hits: list.reduce((n, v) => n + (Number(v.hits) || 0), 0),
		total_active_blocks: list.reduce((n, v) => n + (Number(v.active_blocks) || 0), 0),
		details: {
			version: PULSE_DETAILS_VERSION,
			day_partition: PULSE_DAY_PARTITION_LABEL,
			timestamps: PULSE_TIMESTAMPS_TZ,
			flush_trigger: PULSE_FLUSH_TRIGGER_LABEL,
			...meta,
			visitors: list.map((v) => ({
				visitor_key: v.visitor_key,
				user_id: v.user_id ?? null,
				client_id: v.client_id ?? null,
				hits: Number(v.hits) || 0,
				ranges: Array.isArray(v.ranges) ? v.ranges : []
			}))
		}
	};
}

/** @param {string} visitorKey */
export function parseVisitorKey(visitorKey) {
	const raw = String(visitorKey || "");
	if (raw.startsWith("u:")) {
		return { visitor_key: raw, kind: "user", user_id: Number(raw.slice(2)), client_id: null };
	}
	if (raw.startsWith("v:")) {
		return { visitor_key: raw, kind: "anon", user_id: null, client_id: raw.slice(2) };
	}
	return { visitor_key: raw, kind: "unknown", user_id: null, client_id: null };
}

let redis = null;

export function getPulseRedis() {
	if (!redis) redis = Redis.fromEnv();
	return redis;
}

async function scanKeys(r, pattern) {
	const keys = [];
	let cursor = "0";
	do {
		const result = await r.scan(cursor, { match: pattern, count: 200 });
		const next = Array.isArray(result) ? result[0] : "0";
		const batch = Array.isArray(result) ? result[1] : [];
		cursor = next == null ? "0" : String(next);
		for (const k of batch || []) {
			if (k) keys.push(String(k));
		}
	} while (cursor !== "0");
	return keys;
}

/**
 * Load one visitor's Redis state for one US East partition day.
 * @param {import('@upstash/redis').Redis} r
 * @param {string} dayKey
 * @param {string} visitorKey
 */
export async function loadVisitorPulseFromRedis(r, dayKey, visitorKey) {
	const [hash, blockMembers] = await Promise.all([
		r.hgetall(pulseDayHashKey(dayKey, visitorKey)),
		r.smembers(pulseBlocksSetKey(dayKey, visitorKey))
	]);
	const blocks = (Array.isArray(blockMembers) ? blockMembers : []).map((m) => Number(m));
	const hits = Number(hash?.hits) || 0;
	const ranges = mergeBlockIndicesToRanges(dayKey, blocks);
	return {
		...parseVisitorKey(visitorKey),
		hits,
		first_seen: hash?.first_seen || ranges[0]?.[0] || null,
		last_seen: hash?.last_seen || ranges[ranges.length - 1]?.[1] || null,
		ranges,
		active_blocks: blocks.length
	};
}

/**
 * Scan Redis for all visitors on one US East partition day and build flush payload.
 * @param {import('@upstash/redis').Redis} [r]
 * @param {string} dayKey
 */
export async function buildDaySnapshotFromRedis(dayKey, r = getPulseRedis()) {
	const pattern = pulseDayScanPattern(dayKey);
	const prefix = `pulse:day:${dayKey}:`;
	const keys = await scanKeys(r, pattern);
	const visitors = [];

	for (const key of keys.sort()) {
		const visitorKey = key.startsWith(prefix) ? key.slice(prefix.length) : key;
		if (!visitorKey) continue;
		visitors.push(await loadVisitorPulseFromRedis(r, dayKey, visitorKey));
	}

	return buildSnapshotFromVisitors(dayKey, visitors);
}

/**
 * @param {string} visitorKey
 * @param {number} nowMs
 * @param {string} dayKey
 */
export async function recordPulseToRedis(visitorKey, nowMs, dayKey, r = getPulseRedis()) {
	const dedupeOk = await r.set(pulseDedupeKey(visitorKey), "1", {
		nx: true,
		ex: PULSE_DEDUPE_TTL_SEC
	});
	if (dedupeOk == null) return;

	const iso = new Date(nowMs).toISOString();
	const block = String(pulseBlockIndexForDay(dayKey, nowMs));
	const dayHashKey = pulseDayHashKey(dayKey, visitorKey);
	const blocksKey = pulseBlocksSetKey(dayKey, visitorKey);
	const pipe = r.pipeline();
	pipe.hsetnx(dayHashKey, "first_seen", iso);
	pipe.hset(dayHashKey, { last_seen: iso });
	pipe.hincrby(dayHashKey, "hits", 1);
	pipe.expire(dayHashKey, PULSE_DAY_TTL_SEC);
	pipe.sadd(blocksKey, block);
	pipe.expire(blocksKey, PULSE_DAY_TTL_SEC);
	pipe.zadd(PULSE_ACTIVE_KEY, { score: nowMs, member: visitorKey });
	pipe.expire(PULSE_ACTIVE_KEY, PULSE_ACTIVE_TTL_SEC);
	await pipe.exec();
}

/** Previous US East partition day (nightly flush default). */
export function yesterdayUsEastDayKey() {
	const todayStart = usEastDayStartMs(usEastDayKey());
	return usEastDayKey(new Date(todayStart - 1));
}
