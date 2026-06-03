import express from "express";
import { canAccessFeedBeta, feedBetaEnabledForClient } from "./access.js";

export default function createFeedBetaRoutes({ queries }) {
	const router = express.Router();

	router.get("/api/feed-beta/access", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		const user = await queries.selectUserById.get(req.auth.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}
		const enabled = feedBetaEnabledForClient(user);
		return res.json({
			feedBetaEnabled: enabled,
			canAccess: enabled
		});
	});

	router.get("/api/feed-beta", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		const user = await queries.selectUserById.get(req.auth.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}
		if (!canAccessFeedBeta(user)) {
			return res.status(403).json({
				error: "Feed beta not enabled for this account",
				feedBetaEnabled: false,
				canAccess: false
			});
		}
		return res.json({
			feedBetaEnabled: true,
			canAccess: true,
			items: [],
			hasMore: false,
			message: "Ranked feed delivery is not implemented yet."
		});
	});

	return router;
}
