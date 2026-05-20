import { openDb } from "../../db/index.js";
import {
	buildDaySnapshotFromRedis,
	utcDayKey,
	yesterdayUtcDayKey
} from "./visitPulseCore.js";

/**
 * Flush Redis visit pulse for one UTC day into prsn_visit_pulse_days / visit_pulse_days.
 * @param {{ args?: { day?: string } }} opts  day = YYYY-MM-DD; default yesterday UTC
 */
export async function runVisitPulseFlush({ args = {} } = {}) {
	const rawDay = typeof args?.day === "string" ? args.day.trim() : "";
	const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : yesterdayUtcDayKey();

	const snapshot = await buildDaySnapshotFromRedis(dayKey);
	snapshot.flushed_at = new Date().toISOString();

	const { queries } = await openDb({ quiet: true });
	if (!queries.upsertVisitPulseDay?.run) {
		throw new Error("upsertVisitPulseDay query is not available");
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

/** Manual / backfill: flush today UTC from Redis. */
export async function runVisitPulseFlushToday() {
	return runVisitPulseFlush({ args: { day: utcDayKey() } });
}
