/**
 * Landing-funnel counters. The daily flush copies these Redis keys into visit-pulse details.
 */

import { getPulseRedis, PULSE_DAY_TTL_SEC, usEastDayKey } from "./visitPulse.js";

export const LANDING_FUNNEL_EVENTS = ["view", "video_play", "video_complete", "cta_click"];

export function landingFunnelTotalsKey(dayKey, variant) {
	return `pulse:landing:totals:${dayKey}:${variant}`;
}

export function landingFunnelUniqueSetKey(dayKey, variant, eventType) {
	return `pulse:landing:uniq:${dayKey}:${variant}:${eventType}`;
}

const CLIENT_LANDING_EVENTS = new Set(["video_play", "video_complete", "cta_click"]);

export function isValidClientLandingEvent(eventType) {
	return CLIENT_LANDING_EVENTS.has(eventType);
}

export function resolveLandingVisitorKey(req) {
	const userId = Number(req?.auth?.userId);
	if (Number.isFinite(userId) && userId > 0) return `u:${userId}`;
	const cid = typeof req?.clientId === "string"
		? req.clientId.trim()
		: typeof req?.cookies?.prsn_cid === "string"
			? req.cookies.prsn_cid.trim()
			: "";
	if (cid) return `v:${cid}`;
	return null;
}

export async function recordLandingFunnelToRedis({ visitorKey, eventType, variant = "video", nowMs = Date.now() } = {}, r = getPulseRedis()) {
	const event = typeof eventType === "string" ? eventType.trim() : "";
	if (!LANDING_FUNNEL_EVENTS.includes(event)) return;
	const name = typeof variant === "string" && variant.trim() ? variant.trim().slice(0, 32) : "video";
	const dayKey = usEastDayKey(new Date(nowMs));
	const totalsKey = landingFunnelTotalsKey(dayKey, name);
	const pipe = r.pipeline();
	pipe.hincrby(totalsKey, event, 1);
	pipe.expire(totalsKey, PULSE_DAY_TTL_SEC);
	if (visitorKey) {
		const uniqKey = landingFunnelUniqueSetKey(dayKey, name, event);
		pipe.sadd(uniqKey, visitorKey);
		pipe.expire(uniqKey, PULSE_DAY_TTL_SEC);
	}
	await pipe.exec();
}

function variantSnapshot(totals, uniques) {
	const out = {};
	for (const event of LANDING_FUNNEL_EVENTS) {
		out[`${event}_total`] = Number(totals?.[event]) || 0;
		out[`${event}_unique`] = Number(uniques?.[event]) || 0;
	}
	return out;
}

export async function buildLandingFunnelSnapshotFromRedis(dayKey, r = getPulseRedis()) {
	const by_variant = {};
	for (const variant of ["video", "try"]) {
		const totals = await r.hgetall(landingFunnelTotalsKey(dayKey, variant));
		if (!totals || !Object.keys(totals).length) continue;
		const uniques = {};
		for (const event of LANDING_FUNNEL_EVENTS) {
			uniques[event] = Number(await r.scard(landingFunnelUniqueSetKey(dayKey, variant, event))) || 0;
		}
		by_variant[variant] = variantSnapshot(totals, uniques);
	}
	if (!Object.keys(by_variant).length) return null;
	return { by_variant };
}

export function attachLandingFunnelToPulseSnapshot(snapshot, landingSnapshot) {
	if (!snapshot || typeof snapshot !== "object") return snapshot;
	if (!landingSnapshot?.by_variant || !Object.keys(landingSnapshot.by_variant).length) return snapshot;
	return {
		...snapshot,
		details: {
			...(snapshot.details && typeof snapshot.details === "object" ? snapshot.details : {}),
			landing_funnel: landingSnapshot
		}
	};
}
