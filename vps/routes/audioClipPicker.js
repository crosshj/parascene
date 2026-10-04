import express from 'express';
import { canEditClip, enrichAudioClipRowsWithThumbnails, formatAudioClipListRow } from '../services/create/audioClips.js';

function parsePositiveInt(raw, fallback) {
 const n = Number(raw);
 return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Create's audio library picker; editing the library remains a separate workflow.
export function createAudioClipPickerRoutes({ queries, storage }) {
 const router = express.Router();
	router.get("/api/audio-clips", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const fn = queries.selectAudioClipsForOwner?.page;
			if (typeof fn !== "function") {
				return res.status(501).json({ error: "Audio clips are not available" });
			}
			const limit = parsePositiveInt(req.query?.limit, 24);
			const offset = Math.max(0, Number(req.query?.offset) || 0);
			const sortRaw = String(req.query?.sort ?? "last_used_at").trim().toLowerCase();
			const sort = ["last_used_at", "usage_count", "created_at"].includes(sortRaw)
				? sortRaw
				: "last_used_at";
			const { items, total } = await fn(req.auth.userId, { limit, offset, sort });
			const rawItems = Array.isArray(items) ? items : [];
			const user = await queries.selectUserById.get(req.auth.userId);
			const rows = rawItems
				.map((row) => formatAudioClipListRow(row, { includeAudioUrl: true }))
				.filter(Boolean);
			const enriched = await enrichAudioClipRowsWithThumbnails(rows, rawItems, queries, storage);
			const itemsOut = enriched.map((item, index) => ({
				...item,
				can_edit: canEditClip(user, rawItems[index])
			}));
			res.set("Cache-Control", "private, max-age=15");
			return res.json({ items: itemsOut, total, limit, offset, sort });
		} catch (err) {
			console.error("[audio-clips list]", err);
			return res.status(500).json({ error: "Failed to load audio clips" });
		}
	});

 return router;
}
