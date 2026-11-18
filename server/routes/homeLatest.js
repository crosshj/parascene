import express from "express";
import { requireAuth } from "./middleware/auth.js";
import { serializeCreation } from "./creations.js";
import { homeLatestMediaType } from "../db/homeLatest.js";

const TYPES = new Set(["image", "video", "audio"]);

function limitFor(value) {
	const n = Number.parseInt(String(value ?? ""), 10);
	return Number.isInteger(n) ? Math.min(24, Math.max(1, n)) : 12;
}

const EMPTY_ENGAGEMENT = { like_count: 0, comment_count: 0, viewer_liked: false, liked_by: [], commented_by: [] };

async function engagementFor(creations, userId, rows) {
	if (typeof creations?.engagementForViewer !== "function") return {};
	return creations.engagementForViewer(userId, rows.map((row) => row.id));
}

export function createHomeLatestRoutes({ homeLatest, users, creations }) {
	const router = express.Router();
	router.get("/api/home/latest", requireAuth, async (req, res, next) => {
		try {
			const type = String(req.query.type || "").trim().toLowerCase();
			if (!TYPES.has(type)) return res.status(400).json({ error: "Invalid type" });
			const viewer = await users.byId(req.auth.userId);
			if (!viewer) return res.status(401).json({ error: "Unauthorized" });
			const rows = await homeLatest.latestPublished(type, {
				limit: limitFor(req.query.limit),
				viewerEnableNsfw: viewer.meta?.enableNsfw === true
			});
			const engagement = await engagementFor(creations, viewer.id, rows);
			res.set("Cache-Control", "private, no-store");
			return res.json({ items: rows.map((row) => presentHomeCreation(row, engagement[String(row.id)])) });
		} catch (error) {
			return next(error);
		}
	});
	router.get("/api/home/newbies", requireAuth, async (req, res, next) => {
		try {
			const viewer = await users.byId(req.auth.userId);
			if (!viewer) return res.status(401).json({ error: "Unauthorized" });
			const rows = await homeLatest.latestNewUsers({
				limit: limitFor(req.query.limit),
				viewerEnableNsfw: viewer.meta?.enableNsfw === true
			});
			const engagement = await engagementFor(creations, viewer.id, rows);
			res.set("Cache-Control", "private, no-store");
			return res.json({ items: rows.map((row) => presentHomeCreation(row, engagement[String(row.id)])) });
		} catch (error) {
			return next(error);
		}
	});
	return router;
}

function presentHomeCreation(row, engagement) {
	return {
		...serializeCreation(row),
		created_image_id: row.id,
		media_type: homeLatestMediaType(row),
		...(String(row.user_name || "").trim() ? { user_name: String(row.user_name).trim() } : {}),
		...(engagement || EMPTY_ENGAGEMENT)
	};
}
