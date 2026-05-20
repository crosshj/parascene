#!/usr/bin/env node
/**
 * Visit pulse report: DB (flushed days) or Redis (--live, in-progress today).
 *
 * Usage:
 *   node scripts/analytics/visit-pulse-report.cjs
 *   node scripts/analytics/visit-pulse-report.cjs --day 2026-05-20
 *   node scripts/analytics/visit-pulse-report.cjs --live
 *   node scripts/analytics/visit-pulse-report.cjs --json
 *
 * DB: apply db/schemas/supabase_11_visit_pulse_days.sql in Supabase.
 * Redis: UPSTASH_REDIS_REST_* in .env
 */

const { loadEnv } = require("../repo-root.cjs");
loadEnv();

function getArg(name) {
	const argv = process.argv.slice(2);
	const long = `--${name}`;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === long && argv[i + 1] != null && !argv[i + 1].startsWith("--")) {
			return String(argv[i + 1]).trim();
		}
		if (argv[i].startsWith(`${long}=`)) return argv[i].slice(long.length + 1).trim();
	}
	return "";
}

function hasFlag(name) {
	return process.argv.slice(2).includes(`--${name}`);
}

function utcDayKey(date = new Date()) {
	return date.toISOString().slice(0, 10);
}

function pad(str, width) {
	const s = String(str ?? "");
	return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function formatRanges(ranges) {
	if (!Array.isArray(ranges) || !ranges.length) return "(no ranges)";
	return ranges
		.map(([a, b]) => {
			const sa = a ? a.replace("T", " ").replace(".000Z", "Z") : "?";
			const sb = b ? b.replace("T", " ").replace(".000Z", "Z") : "?";
			return `${sa} → ${sb}`;
		})
		.join("; ");
}

/** @param {string} dayKey @param {Array<[string,string]>} ranges */
function renderTimeline(dayKey, ranges, blocksPerDay, blockMinutes) {
	const chars = new Array(blocksPerDay).fill("·");
	const dayStart = Date.parse(`${dayKey}T00:00:00.000Z`);
	for (const [startIso, endIso] of ranges || []) {
		const startMs = Date.parse(startIso);
		const endMs = Date.parse(endIso);
		if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
		for (let b = 0; b < blocksPerDay; b++) {
			const bStart = dayStart + b * blockMinutes * 60 * 1000;
			const bEnd = bStart + blockMinutes * 60 * 1000;
			if (bEnd > startMs && bStart < endMs) chars[b] = "#";
		}
	}
	return chars.join("");
}

async function loadFromDb(dayKey) {
	const { openDb } = await import("../../db/index.js");
	const { queries } = await openDb({ quiet: true });
	if (!queries.selectVisitPulseDay?.get) {
		throw new Error("selectVisitPulseDay not available — apply visit_pulse_days schema");
	}
	return queries.selectVisitPulseDay.get(dayKey);
}

async function loadLiveFromRedis(dayKey) {
	const { buildDaySnapshotFromRedis, PULSE_ACTIVE_KEY, parseVisitorKey } = await import(
		"../../api_routes/utils/visitPulseCore.js"
	);
	const { Redis } = await import("@upstash/redis");
	const redis = Redis.fromEnv();
	const snapshot = await buildDaySnapshotFromRedis(dayKey, redis);
	const raw = await redis.zrange(PULSE_ACTIVE_KEY, 0, -1, { withScores: true });
	const activeNow = [];
	if (Array.isArray(raw)) {
		for (let i = 0; i < raw.length; i += 2) {
			if (!raw[i]) continue;
			activeNow.push({
				...parseVisitorKey(raw[i]),
				last_pulse_at: Number.isFinite(Number(raw[i + 1])) ? new Date(Number(raw[i + 1])).toISOString() : null
			});
		}
	}
	return { snapshot, activeNow };
}

function printReport({ dayKey, source, row, activeNow, blocksPerDay, blockMinutes, asJson }) {
	const visitors = row?.details?.visitors ?? [];
	const summary = {
		day: dayKey,
		source,
		unique_visitors: row?.unique_visitors ?? 0,
		authed_visitors: row?.authed_visitors ?? 0,
		anon_visitors: row?.anon_visitors ?? 0,
		total_hits: row?.total_hits ?? 0,
		total_active_blocks: row?.total_active_blocks ?? 0,
		flushed_at: row?.flushed_at ?? null,
		active_now: activeNow?.length ?? 0
	};

	if (asJson) {
		console.log(JSON.stringify({ summary, visitors, active_now: activeNow ?? [] }, null, 2));
		return;
	}

	console.log(`Visit pulse — ${dayKey} (UTC)  [${source}]`);
	console.log("");
	console.log(
		`Visitors: ${summary.unique_visitors}  (authed ${summary.authed_visitors}, anon ${summary.anon_visitors})`
	);
	console.log(`Hits (throttled pulses): ${summary.total_hits}`);
	console.log(`Active 15-min blocks: ${summary.total_active_blocks}`);
	if (summary.flushed_at) console.log(`Flushed at: ${summary.flushed_at}`);
	if (summary.active_now) console.log(`Active now (Redis): ${summary.active_now}`);
	console.log("");
	console.log(`Timeline: # = active 15-min block, · = idle (${blockMinutes}m blocks, UTC)`);
	console.log("");

	if (activeNow?.length) {
		console.log("--- Active now ---");
		for (const v of activeNow) {
			const label = v.user_id != null ? `user ${v.user_id}` : `anon ${String(v.client_id || "").slice(0, 8)}…`;
			console.log(`  ${label}  ${v.last_pulse_at || "?"}`);
		}
		console.log("");
	}

	if (!visitors.length) {
		console.log("No visitors for this day.");
		if (source === "db") {
			console.log("Run flush: node scripts/analytics/visit-pulse-flush.cjs --day " + dayKey);
		} else {
			console.log("Browse the site (middleware records pulses) or try --live after traffic.");
		}
		return;
	}

	for (const v of visitors) {
		const id =
			v.user_id != null
				? `user ${v.user_id}`
				: v.client_id
					? `anon ${String(v.client_id).slice(0, 12)}`
					: v.visitor_key;
		console.log(`${pad(id, 20)} hits ${pad(v.hits ?? 0, 5)}`);
		console.log(`  ${renderTimeline(dayKey, v.ranges, blocksPerDay, blockMinutes)}`);
		console.log(`  ${formatRanges(v.ranges)}`);
		console.log("");
	}
}

async function main() {
	const dayKey = getArg("day") || utcDayKey();
	const asJson = hasFlag("json");
	const live = hasFlag("live");
	const { PULSE_BLOCK_MINUTES, PULSE_BLOCKS_PER_DAY } = await import(
		"../../api_routes/utils/visitPulseCore.js"
	);

	if (live) {
		const { snapshot, activeNow } = await loadLiveFromRedis(dayKey);
		printReport({
			dayKey,
			source: "redis-live",
			row: snapshot,
			activeNow,
			blocksPerDay: PULSE_BLOCKS_PER_DAY,
			blockMinutes: PULSE_BLOCK_MINUTES,
			asJson
		});
		return;
	}

	let row = null;
	try {
		row = await loadFromDb(dayKey);
	} catch (err) {
		console.error("[visit-pulse-report] DB:", err?.message || err);
	}

	if (row) {
		printReport({
			dayKey,
			source: "db",
			row,
			activeNow: [],
			blocksPerDay: PULSE_BLOCKS_PER_DAY,
			blockMinutes: PULSE_BLOCK_MINUTES,
			asJson
		});
		return;
	}

	const today = utcDayKey();
	if (dayKey === today) {
		try {
			const { snapshot, activeNow } = await loadLiveFromRedis(dayKey);
			if (snapshot.unique_visitors > 0) {
				printReport({
					dayKey,
					source: "redis-live (not flushed)",
					row: snapshot,
					activeNow,
					blocksPerDay: PULSE_BLOCKS_PER_DAY,
					blockMinutes: PULSE_BLOCK_MINUTES,
					asJson
				});
				return;
			}
		} catch (err) {
			console.error("[visit-pulse-report] Redis:", err?.message || err);
		}
	}

	printReport({
		dayKey,
		source: "none",
		row: { details: { visitors: [] } },
		activeNow: [],
		blocksPerDay: PULSE_BLOCKS_PER_DAY,
		blockMinutes: PULSE_BLOCK_MINUTES,
		asJson
	});
}

main().catch((err) => {
	console.error("[visit-pulse-report]", err?.message || err);
	process.exit(1);
});
