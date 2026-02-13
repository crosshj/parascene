import express from "express";
import { getThumbnailUrl } from "./utils/url.js";

const RELATED_LIMIT_CAP = 24;
const SEED_IDS_CAP = 10;

function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function mapRelatedItemsToResponse(items, viewerLikedIds) {
	const likedSet = new Set((viewerLikedIds ?? []).map(String));
	return (Array.isArray(items) ? items : []).map((item) => {
		const imageUrl = item?.url ?? null;
		const author = item?.author_display_name ?? item?.author_user_name ?? "";
		return {
			id: item?.id,
			title: escapeHtml(item?.title != null ? item.title : "Untitled"),
			summary: escapeHtml(item?.summary != null ? item.summary : ""),
			author,
			author_user_name: item?.author_user_name ?? null,
			author_display_name: item?.author_display_name ?? null,
			author_avatar_url: item?.author_avatar_url ?? null,
			tags: item?.tags ?? null,
			created_at: item?.created_at,
			image_url: imageUrl,
			thumbnail_url: getThumbnailUrl(imageUrl),
			created_image_id: item?.created_image_id ?? item?.id ?? null,
			user_id: item?.user_id ?? null,
			like_count: Number(item?.like_count ?? 0),
			comment_count: Number(item?.comment_count ?? 0),
			viewer_liked: likedSet.has(String(item?.id ?? item?.created_image_id))
		};
	});
}

export default function createCreationsRoutes({ queries }) {
	const router = express.Router();

	router.get("/api/creations", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const user = await queries.selectUserById.get(req.auth?.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		const creations = await queries.selectCreationsForUser.all(user.id);
		return res.json({ creations });
	});

	router.get("/api/creations/:id/related", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const id = parseInt(req.params.id, 10);
			if (!Number.isFinite(id) || id < 1) {
				return res.status(400).json({ error: "Invalid creation id" });
			}

			const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 10), RELATED_LIMIT_CAP);
			const seedIdsRaw = req.query.seed_ids;
			const seedIds = typeof seedIdsRaw === "string" && seedIdsRaw
				? seedIdsRaw.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0).slice(0, SEED_IDS_CAP)
				: undefined;
			const excludeIdsRaw = req.query.exclude_ids;
			const excludeIds = typeof excludeIdsRaw === "string" && excludeIdsRaw
				? excludeIdsRaw.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n))
				: undefined;

			const selectRelated = queries.selectRelatedToCreatedImage?.all;
			if (typeof selectRelated !== "function") {
				return res.json({ items: [], hasMore: false });
			}

			const params = await queries.getRelatedParams?.get?.() ?? {};
			const { ids, hasMore } = await selectRelated(id, req.auth?.userId, {
				limit,
				seedIds,
				excludeIds,
				params
			});

			if (!ids || ids.length === 0) {
				return res.json({ items: [], hasMore: false });
			}

			const feedByCreation = queries.selectFeedItemsByCreationIds?.all;
			const items = typeof feedByCreation === "function" ? await feedByCreation(ids) : [];
			const viewerLikedIds = typeof queries.selectViewerLikedCreationIds?.all === "function"
				? await queries.selectViewerLikedCreationIds.all(req.auth?.userId, ids)
				: [];
			const itemsWithImages = mapRelatedItemsToResponse(items, viewerLikedIds);

			return res.json({ items: itemsWithImages, hasMore: !!hasMore });
		} catch (err) {
			console.error("[creations] related error:", err);
			if (!res.headersSent) res.status(500).json({ error: "Unable to load related creations." });
		}
	});

	router.post("/api/creations/transitions", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const fromId = req.body?.from_created_image_id != null ? parseInt(req.body.from_created_image_id, 10) : null;
			const toId = req.body?.to_created_image_id != null ? parseInt(req.body.to_created_image_id, 10) : null;
			if (!Number.isFinite(fromId) || !Number.isFinite(toId) || fromId < 1 || toId < 1 || fromId === toId) {
				return res.status(400).json({ error: "Invalid from_created_image_id or to_created_image_id" });
			}

			const recordTransition = queries.recordTransition?.run;
			if (typeof recordTransition !== "function") {
				return res.status(204).end();
			}

			await recordTransition(fromId, toId);
			return res.status(204).end();
		} catch (err) {
			console.error("[creations] transitions error:", err);
			if (!res.headersSent) res.status(500).json({ error: "Unable to record transition." });
		}
	});

	return router;
}
