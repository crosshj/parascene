import express from "express";

/** Recent window for “online” (matches client heartbeat interval). */
const PRESENCE_ONLINE_WINDOW_MS = 3 * 60 * 1000;

export default function createPresenceRoutes({ queries }) {
	const router = express.Router();

	router.get("/api/presence/online", async (req, res) => {
		if (!queries.listPresenceOnlineUsers?.all) {
			return res.status(501).json({ error: "Not available" });
		}
		const raw = req.query?.limit;
		const limit = Math.min(500, Math.max(1, Number(raw) || 200));
		const since = new Date(Date.now() - PRESENCE_ONLINE_WINDOW_MS).toISOString();
		try {
			const users = await queries.listPresenceOnlineUsers.all(since, limit);
			return res.json({ users: users ?? [], windowMs: PRESENCE_ONLINE_WINDOW_MS });
		} catch (err) {
			console.warn("[presence] list online", err?.message || err);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.post("/api/presence/heartbeat", async (req, res) => {
		const userId = req.auth?.userId;
		if (!userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		if (!queries.presenceHeartbeat?.run) {
			return res.status(501).json({ error: "Not available" });
		}
		try {
			await queries.presenceHeartbeat.run(userId);
			return res.json({ ok: true });
		} catch (err) {
			console.warn("[presence] heartbeat", err?.message || err);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.patch("/api/presence/settings", async (req, res) => {
		const userId = req.auth?.userId;
		if (!userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		if (!queries.setUserAppearOffline?.run) {
			return res.status(501).json({ error: "Not available" });
		}
		const raw = req.body?.appear_offline;
		if (typeof raw !== "boolean") {
			return res.status(400).json({ error: "appear_offline must be a boolean" });
		}
		try {
			await queries.setUserAppearOffline.run(userId, raw);
			return res.json({ ok: true, appear_offline: raw });
		} catch (err) {
			console.warn("[presence] settings", err?.message || err);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	return router;
}
