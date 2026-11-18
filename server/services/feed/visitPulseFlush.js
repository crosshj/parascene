/**
 * Flush one US East partition day from Redis into prsn_visit_pulse_days.
 * Nightly default is yesterday US East (00:10 Eastern / 05:10 UTC).
 * Redis replaces the DB row. An empty visit key set does not zero a day that
 * already has visitors, but feed impressions and landing funnel still merge in
 * when those Redis keys exist.
 */

import { createSupabaseContext } from "../../db/supabase.js";
import { createVisitPulseQueries } from "../../db/visitPulse.js";
import {
	attachFeedImpressionsToPulseSnapshot,
	buildFeedImpressionSnapshotFromRedis
} from "./impressions.js";
import {
	attachLandingFunnelToPulseSnapshot,
	buildLandingFunnelSnapshotFromRedis
} from "./landingFunnel.js";
import {
	buildDaySnapshotFromRedis,
	usEastDayKey,
	usEastDayStartMs,
	yesterdayUsEastDayKey
} from "./visitPulse.js";

function detailsOf(row) {
	const details = row?.details;
	if (details && typeof details === "object" && !Array.isArray(details)) return details;
	if (typeof details === "string") {
		try {
			const parsed = JSON.parse(details);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
		} catch {
			return {};
		}
	}
	return {};
}

function openQueries() {
	return createVisitPulseQueries(createSupabaseContext().client);
}

/**
 * @param {{ args?: { day?: string, force?: boolean|string|number }, queries?: object, loadVisit?: Function, loadFeed?: Function, loadLanding?: Function }} [opts]
 */
export async function runVisitPulseFlush({ args = {}, queries, loadVisit, loadFeed, loadLanding } = {}) {
	const rawDay = typeof args?.day === "string" ? args.day.trim() : "";
	const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : yesterdayUsEastDayKey();
	const q = queries || openQueries();
	if (!q.upsertVisitPulseDay?.run) throw new Error("upsertVisitPulseDay query is not available");

	let snapshot = await (loadVisit || buildDaySnapshotFromRedis)(dayKey);
	const feedSnapshot = await (loadFeed || buildFeedImpressionSnapshotFromRedis)(dayKey);
	const landingSnapshot = await (loadLanding || buildLandingFunnelSnapshotFromRedis)(dayKey);
	snapshot = attachFeedImpressionsToPulseSnapshot(snapshot, feedSnapshot);
	snapshot = attachLandingFunnelToPulseSnapshot(snapshot, landingSnapshot);
	snapshot.flushed_at = new Date().toISOString();

	const force = args.force === true || args.force === "true" || args.force === 1;
	const existing = q.selectVisitPulseDay?.get ? await q.selectVisitPulseDay.get(dayKey) : null;
	const existingDetails = detailsOf(existing);
	const redisEmpty = Number(snapshot.unique_visitors) === 0;
	const dbHadData = Number(existing?.unique_visitors) > 0;
	const feedRedisEmpty = Number(feedSnapshot?.unique_impressors) === 0;
	const dbHadFeed = Number(existingDetails.feed_impressions?.unique_impressors) > 0;
	const landingRedisEmpty = !landingSnapshot?.by_variant || !Object.keys(landingSnapshot.by_variant).length;
	const dbHadLanding = Boolean(existingDetails.landing_funnel?.by_variant);

	if (!force && redisEmpty && dbHadData) {
		if (feedRedisEmpty && landingRedisEmpty) {
			return {
				ok: false,
				skipped: true,
				day: dayKey,
				reason: "Redis has no keys for this day (TTL ~72h) but DB already has visitors — refusing to overwrite. Use force only if you intend to clear the row.",
				existing_unique_visitors: existing.unique_visitors,
				existing_authed_visitors: existing.authed_visitors
			};
		}
		const details = { ...existingDetails };
		if (!feedRedisEmpty) details.feed_impressions = feedSnapshot;
		if (!landingRedisEmpty) details.landing_funnel = landingSnapshot;
		await q.upsertVisitPulseDay.run({
			day: dayKey,
			unique_visitors: existing.unique_visitors,
			authed_visitors: existing.authed_visitors,
			anon_visitors: existing.anon_visitors,
			total_hits: existing.total_hits,
			total_active_blocks: existing.total_active_blocks,
			flushed_at: snapshot.flushed_at,
			details
		});
		return {
			ok: true,
			preserved_visits: true,
			day: dayKey,
			unique_visitors: Number(existing.unique_visitors) || 0,
			authed_visitors: Number(existing.authed_visitors) || 0,
			feed_impression_users: details.feed_impressions?.unique_impressors ?? 0,
			feed_impressions_total: details.feed_impressions?.total_impressions ?? 0,
			landing_funnel_views: details.landing_funnel?.by_variant?.video?.view_total ?? 0
		};
	}

	if (!force && feedRedisEmpty && dbHadFeed) {
		snapshot = {
			...snapshot,
			details: { ...detailsOf(snapshot), feed_impressions: existingDetails.feed_impressions }
		};
	}
	if (!force && landingRedisEmpty && dbHadLanding) {
		snapshot = {
			...snapshot,
			details: { ...detailsOf(snapshot), landing_funnel: existingDetails.landing_funnel }
		};
	}

	await q.upsertVisitPulseDay.run(snapshot);
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
		landing_funnel_views: snapshot.details?.landing_funnel?.by_variant?.video?.view_total ?? 0
	};
}

export async function runVisitPulseFlushToday(options = {}) {
	return runVisitPulseFlush({ ...options, args: { ...(options.args || {}), day: usEastDayKey() } });
}

const FLUSH_DELAY_MS = 24 * 60 * 60 * 1000;

/** Next 05:10 UTC, which is 00:10 US East (fixed UTC-5). */
export function nextVisitPulseFlushAt(now = new Date()) {
	const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 5, 10, 0, 0);
	return next > now.getTime() ? next : next + FLUSH_DELAY_MS;
}

export function msUntilNextVisitPulseFlush(now = new Date()) {
	return nextVisitPulseFlushAt(now) - now.getTime();
}

/** US East days still inside the ~72h Redis TTL, newest first, excluding today. */
export function recoverableUsEastDayKeys(count = 3, now = new Date()) {
	const keys = [];
	let dayStart = usEastDayStartMs(usEastDayKey(now));
	for (let i = 0; i < count; i++) {
		const key = usEastDayKey(new Date(dayStart - 1));
		keys.push(key);
		dayStart = usEastDayStartMs(key);
	}
	return keys;
}

/**
 * Nightly yesterday-US-East flush, plus a boot catch-up of days still inside
 * the Redis TTL. A second run replaces from Redis; it does not double-count.
 */
export function startVisitPulseFlushSchedule({ run = (args) => runVisitPulseFlush({ args }), startupDelayMs = 15_000 } = {}) {
	let timer = null;
	let startup = null;
	const arm = () => {
		timer = setTimeout(async () => {
			try {
				const result = await run();
				console.log("[visit-pulse] flush", JSON.stringify(result));
			} catch (err) {
				console.error("[visit-pulse] flush failed", err?.message || err);
			}
			arm();
		}, msUntilNextVisitPulseFlush());
		if (typeof timer.unref === "function") timer.unref();
	};
	arm();
	startup = setTimeout(() => {
		void (async () => {
			for (const day of recoverableUsEastDayKeys()) {
				try {
					const result = await run({ day });
					console.log("[visit-pulse] startup flush", JSON.stringify(result));
				} catch (err) {
					console.error("[visit-pulse] startup flush failed", day, err?.message || err);
				}
			}
		})();
	}, startupDelayMs);
	if (typeof startup.unref === "function") startup.unref();
	return () => {
		clearTimeout(timer);
		clearTimeout(startup);
	};
}
