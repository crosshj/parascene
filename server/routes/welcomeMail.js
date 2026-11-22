import express from "express";
import { runNotificationsCron } from "../services/account/notificationsCron.js";
import { verifyQStashRequest } from "../services/create/qstashVerification.js";

export function createWelcomeMailRoutes({ client }) {
	const router = express.Router();
	router.post("/api/worker/notifications", async (req, res) => {
		res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
		const secret = process.env.CRON_SECRET;
		const header = String(req.headers.authorization || "");
		const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
		const bearerOk = Boolean(secret && token === secret);
		const qstashOk = bearerOk ? false : await verifyQStashRequest(req);
		if (!bearerOk && !qstashOk) return res.status(401).json({ error: "Unauthorized" });
		try {
			return res.json(await runNotificationsCron({ client }));
		} catch (error) {
			console.error("[Cron] Notifications cron failed", error);
			return res.status(error.status || 500).json({ error: error.message || "Cron failed" });
		}
	});
	return router;
}
