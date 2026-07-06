/**
 * Landing funnel daily rollup (US East partition) — Redis hot path, flushed into
 * prsn_visit_pulse_days.details.landing_funnel with visit pulse.
 *
 * Events: view, video_play, video_complete, cta_click.
 * Totals + unique visitors (SET per event) per variant (video | try).
 */

import {
	getPulseRedis,
	PULSE_DAY_TTL_SEC,
	usEastDayKey
} from "./visitPulseCore.js";

export const LANDING_FUNNEL_EVENTS = ["view", "video_play", "video_complete", "cta_click"];

/** @param {string} dayKey @param {string} variant */
export function landingFunnelTotalsKey(dayKey, variant) {
	return `pulse:landing:totals:${dayKey}:${variant}`;
}

/** @param {string} dayKey @param {string} variant @param {string} eventType */
export function landingFunnelUniqueSetKey(dayKey, variant, eventType) {
	return `pulse:landing:uniq:${dayKey}:${variant}:${eventType}`;
}

/**
 * @param {import("express").Request} req
 * @returns {string|null}
 */
export function resolveLandingVisitorKey(req) {
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

/**
 * @param {{ visitorKey?: string|null, eventType: string, variant?: string, nowMs?: number }} opts
 */
export async function recordLandingFunnelToRedis(
	{ visitorKey, eventType, variant = "video", nowMs = Date.now() },
	r = getPulseRedis()
) {
	const event = typeof eventType === "string" ? eventType.trim() : "";
	if (!LANDING_FUNNEL_EVENTS.includes(event)) return;

	const v = typeof variant === "string" && variant.trim() ? variant.trim().slice(0, 32) : "video";
	const dayKey = usEastDayKey(new Date(nowMs));
	const totalsKey = landingFunnelTotalsKey(dayKey, v);
	const pipe = r.pipeline();
	pipe.hincrby(totalsKey, event, 1);
	pipe.expire(totalsKey, PULSE_DAY_TTL_SEC);
	if (visitorKey) {
		const uniqKey = landingFunnelUniqueSetKey(dayKey, v, event);
		pipe.sadd(uniqKey, visitorKey);
		pipe.expire(uniqKey, PULSE_DAY_TTL_SEC);
	}
	await pipe.exec();
}

/**
 * @param {Record<string, string|number>} totals
 * @param {Record<string, number>} uniques
 */
export function buildLandingFunnelVariantSnapshot(totals, uniques) {
	const out = {};
	for (const event of LANDING_FUNNEL_EVENTS) {
		out[`${event}_total`] = Number(totals?.[event]) || 0;
		out[`${event}_unique`] = Number(uniques?.[event]) || 0;
	}
	return out;
}

/**
 * @param {string} dayKey
 * @param {import('@upstash/redis').Redis} [r]
 */
export async function buildLandingFunnelSnapshotFromRedis(dayKey, r = getPulseRedis()) {
	const variants = ["video", "try"];
	const by_variant = {};

	for (const variant of variants) {
		const totals = await r.hgetall(landingFunnelTotalsKey(dayKey, variant));
		if (!totals || !Object.keys(totals).length) continue;

		const uniques = {};
		for (const event of LANDING_FUNNEL_EVENTS) {
			const count = await r.scard(landingFunnelUniqueSetKey(dayKey, variant, event));
			uniques[event] = Number(count) || 0;
		}
		by_variant[variant] = buildLandingFunnelVariantSnapshot(totals, uniques);
	}

	if (!Object.keys(by_variant).length) return null;
	return { by_variant };
}

/**
 * @param {object} snapshot visit pulse flush payload
 * @param {object|null|undefined} landingSnapshot
 */
export function attachLandingFunnelToPulseSnapshot(snapshot, landingSnapshot) {
	if (!snapshot || typeof snapshot !== "object") return snapshot;
	if (!landingSnapshot?.by_variant || !Object.keys(landingSnapshot.by_variant).length) {
		return snapshot;
	}
	return {
		...snapshot,
		details: {
			...(snapshot.details && typeof snapshot.details === "object" ? snapshot.details : {}),
			landing_funnel: landingSnapshot
		}
	};
}
