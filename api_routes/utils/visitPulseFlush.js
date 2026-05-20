import { openDb } from "../../db/index.js";
import {
	buildDaySnapshotFromRedis,
	mergeDaySnapshots,
	usEastDayKey,
	yesterdayUsEastDayKey
} from "./visitPulseCore.js";

/**
 * Flush Redis visit pulse for one US East partition day into prsn_visit_pulse_days.
 * Scheduled at US East EOD (00:10 Eastern); default is yesterday US East.
 * @param {{ args?: { day?: string } }} opts  day = YYYY-MM-DD (US East); default yesterday US East
 */
export async function runVisitPulseFlush({ args = {} } = {}) {
	const rawDay = typeof args?.day === "string" ? args.day.trim() : "";
	const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : yesterdayUsEastDayKey();

	const redisSnapshot = await buildDaySnapshotFromRedis(dayKey);

	const { queries } = await openDb({ quiet: true });
	if (!queries.upsertVisitPulseDay?.run) {
		throw new Error("upsertVisitPulseDay query is not available");
	}

	let existing = null;
	if (queries.selectVisitPulseDay?.get) {
		try {
			existing = await queries.selectVisitPulseDay.get(dayKey);
		} catch {
			existing = null;
		}
	}

	const snapshot = existing
		? mergeDaySnapshots(existing, redisSnapshot)
		: redisSnapshot;
	snapshot.flushed_at = new Date().toISOString();

	await queries.upsertVisitPulseDay.run(snapshot);

	return {
		ok: true,
		day: dayKey,
		merged: Boolean(existing),
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
