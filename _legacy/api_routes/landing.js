import express from "express";
import { isValidClientLandingEvent, recordLandingFunnelEvent } from "./utils/landingAnalytics.js";

export default function createLandingRoutes() {
	const router = express.Router();

	// POST /api/landing/event — client funnel steps (play, complete, CTA).
	router.post("/api/landing/event", async (req, res) => {
		try {
			const body = req.body && typeof req.body === "object" ? req.body : {};
			const eventType = typeof body.event === "string" ? body.event.trim() : "";
			if (!isValidClientLandingEvent(eventType)) {
				return res.status(400).json({ error: "invalid_event" });
			}
			const variant =
				typeof body.variant === "string" && body.variant.trim()
					? body.variant.trim().slice(0, 32)
					: "video";

			await recordLandingFunnelEvent(req, { eventType, variant });
			return res.json({ ok: true });
		} catch (err) {
			console.warn("[POST /api/landing/event]", err?.message || err);
			return res.status(500).json({ error: "landing_event_failed" });
		}
	});

	return router;
}
