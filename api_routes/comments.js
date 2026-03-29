import express from "express";
import { getThumbnailUrl } from "./utils/url.js";

/** Allowed emoji keys for comment reactions, in display order. Must match frontend REACTION_ORDER. */
export const REACTION_ORDER = [
	"thumbsUp", "thumbsDown", "heart", "joy", "grin", "openMouth", "sad", "angry",
	"clap", "hundred", "fire", "thinking", "eyes", "rocket", "pray"
];

const MAX_REACTORS_IN_RESPONSE = 5;

function formatReactorLabel(userName, displayName) {
	const un = (userName || displayName || "").trim();
	return un ? `@${un}` : "";
}

/**
 * Fetch reactions for the given comment ids.
 * Returns a Map: commentId -> {
 *   reactions: { [emojiKey]: [...strings, maybe number] },  // strings = display names, optional number = others count
 *   viewer_reactions: ['thumbsUp', ...]
 * }.
 */
export async function getReactionsForCommentIds(queries, commentIds, viewerId) {
	if (!queries.selectCommentReactionCountsByCommentIds?.all || !Array.isArray(commentIds) || commentIds.length === 0) {
		return new Map();
	}
	const ids = commentIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
	if (ids.length === 0) return new Map();

	const [countRows, viewerRows, reactorRows] = await Promise.all([
		queries.selectCommentReactionCountsByCommentIds.all(ids),
		viewerId != null && Number.isFinite(Number(viewerId))
			? queries.selectViewerReactionsByCommentIds.all(viewerId, ids)
			: Promise.resolve([]),
		queries.selectCommentReactionReactorsByCommentIds?.all
			? queries.selectCommentReactionReactorsByCommentIds.all(ids)
			: Promise.resolve([])
	]);

	const byComment = new Map();
	for (const id of ids) {
		byComment.set(id, { reactions: {}, viewer_reactions: [] });
	}

	const reactorGroups = new Map();
	for (const row of reactorRows ?? []) {
		const cid = Number(row?.comment_id);
		const key = row?.emoji_key;
		if (!Number.isFinite(cid) || !key || !REACTION_ORDER.includes(key)) continue;
		const k = `${cid}:${key}`;
		if (!reactorGroups.has(k)) reactorGroups.set(k, []);
		reactorGroups.get(k).push(row);
	}

	for (const row of countRows ?? []) {
		const cid = Number(row?.comment_id);
		const key = row?.emoji_key;
		if (!Number.isFinite(cid) || !key || !REACTION_ORDER.includes(key)) continue;
		const total = Number(row.count) || 0;
		if (total <= 0) continue;
		const entry = byComment.get(cid);
		if (!entry) continue;
		const rows = reactorGroups.get(`${cid}:${key}`) ?? [];
		const strings = rows.slice(0, MAX_REACTORS_IN_RESPONSE).map((r) =>
			formatReactorLabel(r?.user_name, r?.display_name)
		).filter(Boolean);
		const others = Math.max(0, total - strings.length);
		entry.reactions[key] = others > 0 ? [...strings, others] : strings;
	}

	for (const row of viewerRows ?? []) {
		const cid = Number(row?.comment_id);
		const key = row?.emoji_key;
		if (!Number.isFinite(cid) || !key || !REACTION_ORDER.includes(key)) continue;
		const entry = byComment.get(cid);
		if (entry && entry.reactions[key] && !entry.viewer_reactions.includes(key)) {
			entry.viewer_reactions.push(key);
		}
	}
	return byComment;
}

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

async function requireCreatedImageAccess({ queries, imageId, userId, userRole }) {
	// Owner access
	const owned = await queries.selectCreatedImageById?.get(imageId, userId);
	if (owned) {
		return owned;
	}

	// Published access or admin access
	const anyImage = await queries.selectCreatedImageByIdAnyUser?.get(imageId);
	if (anyImage) {
		const isPublished = isPublishedImage(anyImage);
		const isAdmin = userRole === 'admin';
		if (isPublished || isAdmin) {
			return anyImage;
		}
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

	router.get("/api/comments/latest", async (req, res) => {
		const user = await requireUser(req, res, queries);
		if (!user) return;

		const limit = normalizeLimit(req.query?.limit, 10);
		const before =
			typeof req.query?.before === "string" && req.query.before.trim()
				? req.query.before.trim()
				: null;

		const commentsRaw = await queries.selectLatestCreatedImageComments?.all({ limit, before })
			?? [];

		let comments = (commentsRaw || []).map((row) => {
			const createdImageUrl = row?.created_image_url ?? null;
			return {
				...row,
				created_image_url: createdImageUrl,
				created_image_thumbnail_url: getThumbnailUrl(createdImageUrl)
			};
		});

		const enableNsfw = user.meta?.enableNsfw === true;
		if (!enableNsfw) {
			comments = comments.filter((c) => !c.nsfw);
		}

		const commentIds = comments.map((c) => c.id).filter((id) => id != null);
		const reactionsByComment = await getReactionsForCommentIds(queries, commentIds, user.id);
		for (const c of comments) {
			if (c.id == null) continue;
			const r = reactionsByComment.get(Number(c.id));
			if (r) {
				c.reactions = r.reactions ?? {};
				c.viewer_reactions = r.viewer_reactions ?? [];
			} else {
				c.reactions = {};
				c.viewer_reactions = [];
			}
		}

		const hasMore = comments.length >= limit;

		return res.json({ comments, has_more: hasMore });
	});

	router.get("/api/created-images/:id/activity", async (req, res) => {
		const user = await requireUser(req, res, queries);
		if (!user) return;

		const imageId = Number.parseInt(req.params.id, 10);
		if (!Number.isFinite(imageId) || imageId <= 0) {
			return res.status(400).json({ error: "Invalid image id" });
		}

		const image = await requireCreatedImageAccess({ queries, imageId, userId: user.id, userRole: user.role });
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

		let tips = [];
		if (queries.selectCreatedImageTips?.all && image) {
			try {
				const isCreator = Number(image.user_id) === Number(user.id);
				const isAdmin = String(user.role) === "admin";
				if (isCreator || isAdmin) {
					tips = await queries.selectCreatedImageTips.all(imageId, { order, limit: 200, offset: 0 }) ?? [];
				} else {
					// Only include tips where viewer is the tipper.
					const allTips = await queries.selectCreatedImageTips.all(imageId, { order, limit: 200, offset: 0 }) ?? [];
					tips = allTips.filter((t) => Number(t.user_id) === Number(user.id));
				}
			} catch {
				tips = [];
			}
		}

		const items = [
			...comments.map((c) => ({
				type: "comment",
				...c
			})),
			...tips.map((t) => ({
				type: "tip",
				...t
			}))
		];

		items.sort((a, b) => {
			const aTime = a.created_at ?? a.createdAt ?? "";
			const bTime = b.created_at ?? b.createdAt ?? "";
			const cmp = String(aTime).localeCompare(String(bTime));
			return order === "desc" ? -cmp : cmp;
		});

		const commentIds = items.filter((it) => it.type === "comment").map((it) => it.id).filter((id) => id != null);
		const reactionsByComment = await getReactionsForCommentIds(queries, commentIds, user.id);
		for (const it of items) {
			if (it.type !== "comment" || it.id == null) continue;
			const r = reactionsByComment.get(Number(it.id));
			if (r) {
				it.reactions = r.reactions ?? {};
				it.viewer_reactions = r.viewer_reactions ?? [];
			} else {
				it.reactions = {};
				it.viewer_reactions = [];
			}
		}

		return res.json({ items, comment_count: commentCount });
	});

	router.post("/api/comments/:commentId/reactions", async (req, res) => {
		const user = await requireUser(req, res, queries);
		if (!user) return;

		const commentId = Number.parseInt(req.params.commentId, 10);
		if (!Number.isFinite(commentId) || commentId <= 0) {
			return res.status(400).json({ error: "Invalid comment id" });
		}

		const emojiKey = typeof req.body?.emoji_key === "string" ? req.body.emoji_key.trim() : "";
		if (!emojiKey || !REACTION_ORDER.includes(emojiKey)) {
			return res.status(400).json({ error: "Invalid or missing emoji_key" });
		}

		const comment = await queries.selectCommentById?.get(commentId);
		if (!comment || comment.created_image_id == null) {
			return res.status(404).json({ error: "Comment not found" });
		}

		const imageId = Number(comment.created_image_id);
		const image = await requireCreatedImageAccess({ queries, imageId, userId: user.id, userRole: user.role });
		if (!image) {
			return res.status(404).json({ error: "Image not found" });
		}

		const existing = await queries.selectCommentReactionExists?.get(commentId, user.id, emojiKey);
		if (existing) {
			await queries.deleteCommentReaction?.run(commentId, user.id, emojiKey);
		} else {
			await queries.insertCommentReaction?.run(commentId, user.id, emojiKey);
		}
		const added = !existing;

		let count = 0;
		const countRows = await queries.selectCommentReactionCountsByCommentIds?.all([commentId]) ?? [];
		const row = countRows.find((r) => r.emoji_key === emojiKey);
		if (row) count = Number(row.count) ?? 0;

		return res.json({ added, count });
	});

	router.post("/api/created-images/:id/comments", async (req, res) => {

		const user = await requireUser(req, res, queries);
		if (!user) return;

		const imageId = Number.parseInt(req.params.id, 10);
		if (!Number.isFinite(imageId) || imageId <= 0) {
			return res.status(400).json({ error: "Invalid image id" });
		}

		const image = await requireCreatedImageAccess({ queries, imageId, userId: user.id, userRole: user.role });
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

		// console.log(`[Comments] POST /api/created-images/${req.params.id}/comments`);

		// Best-effort in-app notifications: creation owner + prior commenters (for digest / in-app).
		// Do not block comment creation if notification insert fails.
		try {
			if (queries.insertNotification?.run) {
				const commenterId = Number(user.id);
				const creationTitle = typeof image?.title === "string" ? image.title.trim() : "";
				const title = "New comment";
				const link = `/creations/${encodeURIComponent(String(imageId))}`;
				const target = { creation_id: imageId };
				const meta = creationTitle ? { creation_title: creationTitle } : {};

				// Notify creation owner when someone else comments (so they get digest / in-app).
				const ownerUserId = Number(image?.user_id);
				if (Number.isFinite(ownerUserId) && ownerUserId > 0 && ownerUserId !== commenterId) {
					const message = creationTitle
						? `Someone commented on “${creationTitle}”.`
						: `Someone commented on your creation.`;
					await queries.insertNotification.run(ownerUserId, null, title, message, link, commenterId, "comment", target, meta);
				}

				// Notify prior commenters (excluding current commenter and owner, to avoid duplicate).
				if (queries.selectCreatedImageCommenterUserIdsDistinct?.all) {
					const rawIds = await queries.selectCreatedImageCommenterUserIdsDistinct.all(imageId);
					const recipientIds = Array.from(new Set(
						(rawIds ?? [])
							.map((r) => Number(r?.user_id ?? r))
							.filter((id) => Number.isFinite(id) && id > 0 && id !== commenterId && id !== ownerUserId)
					));

					if (recipientIds.length > 0) {
						const message = creationTitle
							? `Someone commented on “${creationTitle}”.`
							: `Someone commented on a creation you commented on.`;

						for (const toUserId of recipientIds) {
							await queries.insertNotification.run(toUserId, null, title, message, link, commenterId, "comment_thread", target, meta);
						}
					}
				}
			}
		} catch (error) {
			// This catch exists so comment posting still succeeds even if notifications fail.
		}

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

	router.delete("/api/comments/:commentId", async (req, res) => {
		const user = await requireUser(req, res, queries);
		if (!user) return;

		if (String(user.role) !== "admin") {
			return res.status(403).json({ error: "Forbidden" });
		}

		const commentId = Number.parseInt(req.params.commentId, 10);
		if (!Number.isFinite(commentId) || commentId <= 0) {
			return res.status(400).json({ error: "Invalid comment id" });
		}

		const comment = await queries.selectCommentById?.get(commentId);
		if (!comment || comment.created_image_id == null) {
			return res.status(404).json({ error: "Comment not found" });
		}

		const imageId = Number(comment.created_image_id);
		const image = await requireCreatedImageAccess({ queries, imageId, userId: user.id, userRole: user.role });
		if (!image) {
			return res.status(404).json({ error: "Image not found" });
		}

		const del = await queries.deleteCommentById?.run(commentId);
		const changes = Number(del?.changes ?? 0);
		if (!changes) {
			return res.status(404).json({ error: "Comment not found" });
		}

		let commentCount = null;
		try {
			const countRow = await queries.selectCreatedImageCommentCount?.get(imageId);
			commentCount = Number(countRow?.comment_count ?? 0);
		} catch {
			// ignore count failures
		}

		return res.json({ ok: true, comment_count: commentCount });
	});

	return router;
}

