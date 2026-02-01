import express from "express";
import { sendDelegatedEmail, sendTemplatedEmail } from "../email/index.js";
import { getBaseAppUrl, getThumbnailUrl } from "./utils/url.js";

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

function getUserDisplayName(user) {
	const name = typeof user?.name === "string" ? user.name.trim() : "";
	if (name) return name;
	const email = String(user?.email || "").trim();
	const localPart = email.includes("@") ? email.split("@")[0] : email;
	return localPart || "Someone";
}

export default function createCommentsRoutes({ queries }) {
	const router = express.Router();

	router.get("/api/comments/latest", async (req, res) => {
		const user = await requireUser(req, res, queries);
		if (!user) return;

		const limit = normalizeLimit(req.query?.limit, 10);

		const commentsRaw = await queries.selectLatestCreatedImageComments?.all({ limit })
			?? [];

		const comments = (commentsRaw || []).map((row) => {
			const createdImageUrl = row?.created_image_url ?? null;
			return {
				...row,
				created_image_url: createdImageUrl,
				created_image_thumbnail_url: getThumbnailUrl(createdImageUrl)
			};
		});

		return res.json({ comments });
	});

	router.get("/api/created-images/:id/comments", async (req, res) => {
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

		return res.json({ comments, comment_count: commentCount });
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

		// Best-effort in-app notifications for prior commenters on this creation.
		// Do not block comment creation if notification insert fails.
		try {
			if (queries.insertNotification?.run && queries.selectCreatedImageCommenterUserIdsDistinct?.all) {
				const rawIds = await queries.selectCreatedImageCommenterUserIdsDistinct.all(imageId);
				const commenterId = Number(user.id);
				const recipientIds = Array.from(new Set(
					(rawIds ?? [])
						.map((id) => Number(id))
						.filter((id) => Number.isFinite(id) && id > 0 && id !== commenterId)
				));

				if (recipientIds.length > 0) {
					const commenterName = getUserDisplayName(user);
					const creationTitle = typeof image?.title === "string" ? image.title.trim() : "";
					const title = "New comment";
					const link = `/creations/${encodeURIComponent(String(imageId))}`;
					const message = creationTitle
						? `${commenterName} commented on “${creationTitle}”.`
						: `${commenterName} commented on a creation you commented on.`;

					for (const toUserId of recipientIds) {
						await queries.insertNotification.run(toUserId, null, title, message, link);
					}
				}
			}
		} catch (error) {
			// This catch exists so comment posting still succeeds even if notifications fail.
		}

		// Best-effort email notification to the creation owner.
		// Do not block comment creation if email fails.
		try {
			const ownerUserId = Number(image?.user_id);
			if (!Number.isFinite(ownerUserId) || ownerUserId <= 0) {
				// If this happens, the created_images row is missing/invalid.
				// console.warn("[Comments] Skipping comment email: invalid owner user_id on image", {
				// 	imageId,
				// 		ownerUserId: image?.user_id ?? null
				// });
			} else if (ownerUserId === Number(user.id)) {
				// We don't email you about your own comments.
				// console.log("[Comments] Skipping comment email: self-comment", { imageId, ownerUserId });
			} else {
				const owner = await queries.selectUserById?.get(ownerUserId);
				if (!owner) {
					// Owner record missing (data integrity issue).
					// console.warn("[Comments] Skipping comment email: owner user not found", { imageId, ownerUserId });
				} else {
					const ownerEmail = String(owner?.email || "").trim();
					if (!ownerEmail) {
						// No email on file → cannot deliver.
						// console.warn("[Comments] Skipping comment email: owner has no email address", {
						// 	imageId,
						// 	ownerUserId
						// });
					} else {
						const ownerEmailLower = ownerEmail.toLowerCase();
						const shouldSuppress = ownerEmailLower.includes("example.com");
						if (!process.env.RESEND_API_KEY || !process.env.RESEND_SYSTEM_EMAIL) {
							// Most common local/dev issue: missing env vars.
							// console.warn("[Comments] Skipping comment email: Resend env missing", {
							// 	imageId,
							// 	ownerUserId,
							// 	hasResendApiKey: Boolean(process.env.RESEND_API_KEY),
							// 	hasResendSystemEmail: Boolean(process.env.RESEND_SYSTEM_EMAIL)
							// });
						} else if (shouldSuppress) {
							// console.log("[Comments] Sending delegated comment email: suppressed domain match (example.com)", {
							// 	imageId,
							// 	ownerUserId,
							// 	ownerEmailDomain: ownerEmailLower.split("@")[1] || null
							// });

							const baseUrl = getBaseAppUrl();
							const creationPath = `/creations/${encodeURIComponent(String(imageId))}`;
							const creationUrl = new URL(creationPath, baseUrl).toString();
							const commenterName = getUserDisplayName(user);
							const recipientName = getUserDisplayName(owner);
							const creationTitle = typeof image?.title === "string" ? image.title.trim() : "";

							await sendDelegatedEmail({
								template: "commentReceived",
								reason: "Suppressed domain match (example.com)",
								originalRecipient: {
									name: recipientName,
									email: ownerEmail,
									userId: ownerUserId
								},
								data: {
									recipientName,
									commenterName,
									commentText: text,
									creationTitle,
									creationUrl
								}
							});
						} else {
							const baseUrl = getBaseAppUrl();
							const creationPath = `/creations/${encodeURIComponent(String(imageId))}`;
							const creationUrl = new URL(creationPath, baseUrl).toString();
							const commenterName = getUserDisplayName(user);
							const recipientName = getUserDisplayName(owner);
							const creationTitle = typeof image?.title === "string" ? image.title.trim() : "";

							// console.log("[Comments] Sending comment notification email", {
							// 	// ownerEmail,
							// 	recipientName,
							// 	commenterName,
							// 	commentText: text,
							// 	creationTitle,
							// });
							await sendTemplatedEmail({
								to: ownerEmail,
								template: "commentReceived",
								data: {
									recipientName,
									commenterName,
									commentText: text,
									creationTitle,
									creationUrl
								}
							});
						}
					}
				}
			}
		} catch (error) {
			// This catch exists so comment posting still succeeds even if email fails.
			// Common causes:
			// - Missing/invalid Resend env (RESEND_API_KEY / RESEND_SYSTEM_EMAIL)
			// - Resend API error / rate limit
			// - Invalid recipient address
			// console.warn("[Comments] Failed to send comment notification email:", {
			// 	imageId,
			// 	commenterUserId: user?.id ?? null,
			// 	error: error?.message || String(error)
			// });
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

	return router;
}

