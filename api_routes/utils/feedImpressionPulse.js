/**
 * Feed impression daily rollup (US East partition) — Redis hot path, flushed into
 * prsn_visit_pulse_days.details.feed_impressions with visit pulse.
 *
 * Logged-in feed-beta impressions only (dwell + click). Separate from feed-beta:seen dedup SET.
 * Persisted shape is aggregate counts + concentration math (no per-user or per-creation lists).
 */

import {
	getPulseRedis,
	PULSE_DAY_TTL_SEC,
	usEastDayKey
} from "./visitPulseCore.js";

/** @param {string} dayKey @param {number|string} userId */
export function feedImpressionUserHashKey(dayKey, userId) {
	return `pulse:feed-impression:day:${dayKey}:u:${userId}`;
}

/** @param {string} dayKey — hash field = creation id, value = impression count */
export function feedImpressionCreationHitsKey(dayKey) {
	return `pulse:feed-impression:creation-hits:${dayKey}`;
}

/** @param {string} dayKey */
export function feedImpressionDayScanPattern(dayKey) {
	return `pulse:feed-impression:day:${dayKey}:u:*`;
}

/**
 * Concentration of a positive count distribution (users or creations).
 * @param {number[]} values
 */
export function computeConcentrationMetrics(values) {
	const list = (Array.isArray(values) ? values : [])
		.map((v) => Number(v) || 0)
		.filter((v) => v > 0);
	const participants = list.length;
	const sum = list.reduce((a, b) => a + b, 0);
	if (!participants || !sum) {
		return {
			participants: 0,
			top1_share: 0,
			top2_share: 0,
			gini: 0,
			hhi: 0,
			effective_n: 0
		};
	}

	const desc = [...list].sort((a, b) => b - a);
	const asc = [...list].sort((a, b) => a - b);
	const top1 = desc[0] / sum;
	const top2 = (desc[0] + (desc[1] || 0)) / sum;

	let giniNumerator = 0;
	for (let i = 0; i < asc.length; i++) {
		giniNumerator += (2 * (i + 1) - asc.length - 1) * asc[i];
	}
	const gini = giniNumerator / (asc.length * sum);

	let hhi = 0;
	for (const v of list) {
		const p = v / sum;
		hhi += p * p;
	}

	const round3 = (n) => Math.round(n * 1000) / 1000;

	return {
		participants,
		top1_share: round3(top1),
		top2_share: round3(top2),
		gini: round3(gini),
		hhi: round3(hhi),
		effective_n: round3(hhi > 0 ? 1 / hhi : participants)
	};
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

function impressionTrigger(meta) {
	return meta?.trigger === "click" ? "click" : "dwell";
}

/**
 * @param {number|string} userId
 * @param {{ creationId: number, meta?: object }[]} items
 * @param {number} [nowMs]
 */
export async function recordFeedImpressionsToRedis(userId, items, nowMs = Date.now(), r = getPulseRedis()) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0 || !Array.isArray(items) || items.length === 0) return;

	const dayKey = usEastDayKey(new Date(nowMs));
	const userHash = feedImpressionUserHashKey(dayKey, uid);
	const creationHits = feedImpressionCreationHitsKey(dayKey);

	let dwell = 0;
	let click = 0;
	const pipe = r.pipeline();
	for (const item of items) {
		const cid = Number(item?.creationId);
		if (!Number.isFinite(cid) || cid <= 0) continue;
		if (impressionTrigger(item.meta) === "click") click++;
		else dwell++;
		pipe.hincrby(creationHits, String(cid), 1);
	}
	const total = dwell + click;
	if (!total) return;

	pipe.hincrby(userHash, "dwell", dwell);
	pipe.hincrby(userHash, "click", click);
	pipe.hincrby(userHash, "total", total);
	pipe.expire(userHash, PULSE_DAY_TTL_SEC);
	pipe.expire(creationHits, PULSE_DAY_TTL_SEC);
	await pipe.exec();
}

/**
 * @param {{ dwell_impressions: number, click_impressions: number, total_impressions: number }[]} userRows
 * @param {number[]} creationHitCounts
 */
export function buildFeedImpressionSnapshot(userRows, creationHitCounts) {
	const users = Array.isArray(userRows) ? userRows : [];
	let dwell = 0;
	let click = 0;
	const userTotals = [];
	for (const row of users) {
		const d = Number(row.dwell_impressions) || 0;
		const c = Number(row.click_impressions) || 0;
		dwell += d;
		click += c;
		userTotals.push(d + c);
	}
	const creationCounts = (Array.isArray(creationHitCounts) ? creationHitCounts : [])
		.map((v) => Number(v) || 0)
		.filter((v) => v > 0);

	return {
		unique_impressors: users.length,
		total_impressions: dwell + click,
		dwell_impressions: dwell,
		click_impressions: click,
		unique_creations: creationCounts.length,
		concentration: {
			users: computeConcentrationMetrics(userTotals),
			creations: computeConcentrationMetrics(creationCounts)
		}
	};
}

/**
 * @param {string} dayKey
 * @param {import('@upstash/redis').Redis} [r]
 */
export async function buildFeedImpressionSnapshotFromRedis(dayKey, r = getPulseRedis()) {
	const prefix = `pulse:feed-impression:day:${dayKey}:u:`;
	const keys = await scanKeys(r, feedImpressionDayScanPattern(dayKey));
	const userRows = [];

	for (const key of keys.sort()) {
		const uid = Number(key.slice(prefix.length));
		if (!Number.isFinite(uid) || uid <= 0) continue;
		const hash = await r.hgetall(key);
		const dwellImpressions = Number(hash?.dwell) || 0;
		const clickImpressions = Number(hash?.click) || 0;
		userRows.push({
			dwell_impressions: dwellImpressions,
			click_impressions: clickImpressions,
			total_impressions: dwellImpressions + clickImpressions
		});
	}

	const creationHash = await r.hgetall(feedImpressionCreationHitsKey(dayKey));
	const creationHitCounts = Object.values(creationHash || {}).map((v) => Number(v) || 0);
	return buildFeedImpressionSnapshot(userRows, creationHitCounts);
}

/**
 * @param {object} snapshot visit pulse flush payload
 * @param {object|null|undefined} feedSnapshot
 */
export function attachFeedImpressionsToPulseSnapshot(snapshot, feedSnapshot) {
	if (!snapshot || typeof snapshot !== "object") return snapshot;
	if (!feedSnapshot || Number(feedSnapshot.unique_impressors) <= 0) return snapshot;
	return {
		...snapshot,
		details: {
			...(snapshot.details && typeof snapshot.details === "object" ? snapshot.details : {}),
			feed_impressions: feedSnapshot
		}
	};
}
