import { openDb } from "../../db/index.js";
import {
	attachFeedImpressionsToPulseSnapshot,
	buildFeedImpressionSnapshotFromRedis
} from "./feedImpressionPulse.js";
import {
	attachLandingFunnelToPulseSnapshot,
	buildLandingFunnelSnapshotFromRedis
} from "./landingFunnelPulse.js";
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

	let snapshot = await buildDaySnapshotFromRedis(dayKey);
	const feedSnapshot = await buildFeedImpressionSnapshotFromRedis(dayKey);
	const landingSnapshot = await buildLandingFunnelSnapshotFromRedis(dayKey);
	snapshot = attachFeedImpressionsToPulseSnapshot(snapshot, feedSnapshot);
	snapshot = attachLandingFunnelToPulseSnapshot(snapshot, landingSnapshot);
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
	const feedRedisEmpty = Number(feedSnapshot?.unique_impressors) === 0;
	const dbHadFeed =
		Number(existing?.details?.feed_impressions?.unique_impressors) > 0;
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

	const landingRedisEmpty =
		!landingSnapshot?.by_variant || !Object.keys(landingSnapshot.by_variant).length;
	const dbHadLanding = Boolean(existing?.details?.landing_funnel?.by_variant);
	if (!force && feedRedisEmpty && dbHadFeed && existing?.details?.feed_impressions) {
		snapshot = {
			...snapshot,
			details: {
				...(snapshot.details && typeof snapshot.details === "object" ? snapshot.details : {}),
				feed_impressions: existing.details.feed_impressions
			}
		};
	}

	if (!force && landingRedisEmpty && dbHadLanding && existing?.details?.landing_funnel) {
		snapshot = {
			...snapshot,
			details: {
				...(snapshot.details && typeof snapshot.details === "object" ? snapshot.details : {}),
				landing_funnel: existing.details.landing_funnel
			}
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
		total_active_blocks: snapshot.total_active_blocks,
		feed_impression_users: snapshot.details?.feed_impressions?.unique_impressors ?? 0,
		feed_impressions_total: snapshot.details?.feed_impressions?.total_impressions ?? 0,
		landing_funnel_views:
			snapshot.details?.landing_funnel?.by_variant?.video?.view_total ?? 0
	};
}

/** Manual / backfill: flush today US East partition from Redis. */
export async function runVisitPulseFlushToday() {
	return runVisitPulseFlush({ args: { day: usEastDayKey() } });
}
