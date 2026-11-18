/**
 * Landing-funnel read path. Recording stays on the legacy marketing page.
 * The daily flush still copies any Redis keys into visit-pulse details so a
 * later write does not drop them.
 */

import { getPulseRedis } from "./visitPulse.js";

export const LANDING_FUNNEL_EVENTS = ["view", "video_play", "video_complete", "cta_click"];

export function landingFunnelTotalsKey(dayKey, variant) {
	return `pulse:landing:totals:${dayKey}:${variant}`;
}

export function landingFunnelUniqueSetKey(dayKey, variant, eventType) {
	return `pulse:landing:uniq:${dayKey}:${variant}:${eventType}`;
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
