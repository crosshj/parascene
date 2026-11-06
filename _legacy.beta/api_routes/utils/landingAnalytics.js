import {
	recordLandingFunnelToRedis,
	resolveLandingVisitorKey
} from "./landingFunnelPulse.js";

const CLIENT_LANDING_EVENTS = new Set(["video_play", "video_complete", "cta_click"]);

export function isValidClientLandingEvent(eventType) {
	return CLIENT_LANDING_EVENTS.has(eventType);
}

/**
 * @param {import("express").Request} req
 * @param {{ eventType: string, variant?: string }} opts
 */
export async function recordLandingFunnelEvent(req, { eventType, variant = "video" }) {
	await recordLandingFunnelToRedis({
		visitorKey: resolveLandingVisitorKey(req),
		eventType,
		variant
	});
}
