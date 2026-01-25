import express from "express";

async function requireUser(req, res, queries) {
	if (!req.auth?.userId) {
		res.status(401).json({ error: "Unauthorized" });
		return null;
	}

	const user = await queries.selectUserById.get(req.auth.userId);
	if (!user) {
		res.status(404).json({ error: "User not found" });
		return null;
	}

	return user;
}

function isPublishedImage(image) {
	return image?.published === true || image?.published === 1;
}

async function requireCreatedImageAccess({ queries, imageId, userId }) {
	// Owner access
	const owned = await queries.selectCreatedImageById?.get(imageId, userId);
	if (owned) {
		return owned;
	}

	// Published access
	const anyImage = await queries.selectCreatedImageByIdAnyUser?.get(imageId);
	if (anyImage && isPublishedImage(anyImage)) {
		return anyImage;
	}

	return null;
}

function normalizeOrder(raw) {
	const value = String(raw || "").toLowerCase();
	return value === "desc" ? "desc" : "asc";
}

function normalizeLimit(raw, fallback = 50) {
	const n = Number.parseInt(String(raw ?? ""), 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(200, Math.max(1, n));
}

function normalizeOffset(raw) {
	const n = Number.parseInt(String(raw ?? ""), 10);
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, n);
}

export default function createCommentsRoutes({ queries }) {
	const router = express.Router();

	router.get("/api/created-images/:id/comments", async (req, res) => {
		const user = await requireUser(req, res, queries);
		if (!user) return;

		const imageId = Number.parseInt(req.params.id, 10);
		if (!Number.isFinite(imageId) || imageId <= 0) {
			return res.status(400).json({ error: "Invalid image id" });
		}

		const image = await requireCreatedImageAccess({ queries, imageId, userId: user.id });
		if (!image) {
			return res.status(404).json({ error: "Image not found" });
		}

		const order = normalizeOrder(req.query?.order);
		const limit = normalizeLimit(req.query?.limit, 50);
		const offset = normalizeOffset(req.query?.offset);

		const comments = await queries.selectCreatedImageComments?.all(imageId, { order, limit, offset })
			?? [];

		let commentCount = comments.length;
		try {
			const countRow = await queries.selectCreatedImageCommentCount?.get(imageId);
			if (countRow && countRow.comment_count !== undefined) {
				commentCount = Number(countRow.comment_count ?? 0);
			}
		} catch {
			// ignore count failures
		}

		return res.json({ comments, comment_count: commentCount });
	});

	router.post("/api/created-images/:id/comments", async (req, res) => {
		const user = await requireUser(req, res, queries);
		if (!user) return;

		const imageId = Number.parseInt(req.params.id, 10);
		if (!Number.isFinite(imageId) || imageId <= 0) {
			return res.status(400).json({ error: "Invalid image id" });
		}

		const image = await requireCreatedImageAccess({ queries, imageId, userId: user.id });
		if (!image) {
			return res.status(404).json({ error: "Image not found" });
		}

		const rawText = req.body?.text;
		const text = typeof rawText === "string" ? rawText.trim() : "";
		if (!text) {
			return res.status(400).json({ error: "Comment text is required" });
		}
		if (text.length > 2000) {
			return res.status(400).json({ error: "Comment is too long" });
		}

		const comment = await queries.insertCreatedImageComment?.run(user.id, imageId, text);

		let commentCount = null;
		try {
			const countRow = await queries.selectCreatedImageCommentCount?.get(imageId);
			commentCount = Number(countRow?.comment_count ?? 0);
		} catch {
			// ignore count failures
		}

		return res.json({
			comment,
			comment_count: commentCount
		});
	});

	return router;
}

