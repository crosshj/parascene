import { openDb } from "../../db/index.js";
import {
	buildDaySnapshotFromRedis,
	usEastDayKey,
	yesterdayUsEastDayKey
} from "./visitPulseCore.js";

/**
 * Flush Redis visit pulse for one US East partition day into prsn_visit_pulse_days.
 * Scheduled at US East EOD (00:10 Eastern); default is yesterday US East.
 * Redis is the source of truth; existing DB row is replaced (not merged).
 * @param {{ args?: { day?: string } }} opts  day = YYYY-MM-DD (US East); default yesterday US East
 */
export async function runVisitPulseFlush({ args = {} } = {}) {
	const rawDay = typeof args?.day === "string" ? args.day.trim() : "";
	const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : yesterdayUsEastDayKey();

	const snapshot = await buildDaySnapshotFromRedis(dayKey);
	snapshot.flushed_at = new Date().toISOString();

	const { queries } = await openDb({ quiet: true });
	if (!queries.upsertVisitPulseDay?.run) {
		throw new Error("upsertVisitPulseDay query is not available");
	}

	const force = args.force === true || args.force === "true" || args.force === 1;
	const existing = queries.selectVisitPulseDay?.get
		? await queries.selectVisitPulseDay.get(dayKey)
		: null;
	const redisEmpty = Number(snapshot.unique_visitors) === 0;
	const dbHadData = Number(existing?.unique_visitors) > 0;
	if (!force && redisEmpty && dbHadData) {
		return {
			ok: false,
			skipped: true,
			day: dayKey,
			reason:
				"Redis has no keys for this day (TTL ~72h) but DB already has visitors — refusing to overwrite. Use force only if you intend to clear the row.",
			existing_unique_visitors: existing.unique_visitors,
			existing_authed_visitors: existing.authed_visitors
		};
	}

	await queries.upsertVisitPulseDay.run(snapshot);

	return {
		ok: true,
		day: dayKey,
		unique_visitors: snapshot.unique_visitors,
		authed_visitors: snapshot.authed_visitors,
		anon_visitors: snapshot.anon_visitors,
		total_hits: snapshot.total_hits,
		total_active_blocks: snapshot.total_active_blocks
	};
}

/** Manual / backfill: flush today US East partition from Redis. */
export async function runVisitPulseFlushToday() {
	return runVisitPulseFlush({ args: { day: usEastDayKey() } });
}
