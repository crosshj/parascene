import express from "express";
import { runWelcomeMail } from "../services/account/welcomeMail.js";

export function createWelcomeMailRoutes({ client }) {
	const router = express.Router();
	router.post("/api/worker/notifications", async (req, res) => {
		const secret = process.env.CRON_SECRET;
		const header = String(req.headers.authorization || "");
		const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
		if (!secret || token !== secret) return res.status(401).json({ error: "Unauthorized" });
		try {
			return res.json(await runWelcomeMail({ client }));
		} catch (error) {
			return res.status(error.status || 500).json({ error: error.message || "Welcome mail failed" });
		}
	});
	return router;
}
