import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { getThumbnailUrl } from "./utils/url.js";
import { runCreationJob, PROVIDER_TIMEOUT_MS } from "./utils/creationJob.js";
import { scheduleCreationJob } from "./utils/scheduleCreationJob.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function createCreateRoutes({ queries, storage }) {
	const router = express.Router();
	// Serve created images statically (for filesystem-based adapters)
	// This will be used as fallback for filesystem adapters
	const imagesDir = path.join(__dirname, "..", "db", "data", "images", "created");
	router.use("/images/created", express.static(imagesDir));

	// GET /api/images/created/:filename - Serve image through backend
	// This route handles images from Supabase Storage and provides authorization
	router.get("/api/images/created/:filename", async (req, res) => {
		const filename = req.params.filename;
		const variant = req.query?.variant;

		try {
			// Find the image in the database by filename
			const image = await queries.selectCreatedImageByFilename?.get(filename);

			if (!image) {
				return res.status(404).json({ error: "Image not found" });
			}

			// Check access: user owns the image OR image is published OR user is admin
			const userId = req.auth?.userId;
			const isOwner = userId && image.user_id === userId;
			const isPublished = image.published === 1 || image.published === true;
			
			// Get user to check admin role
			let isAdmin = false;
			if (userId && !isOwner && !isPublished) {
				try {
					const user = await queries.selectUserById.get(userId);
					isAdmin = user?.role === 'admin';
				} catch {
					// ignore errors checking user
				}
			}

			if (!isOwner && !isPublished && !isAdmin) {
				return res.status(403).json({ error: "Access denied" });
			}

			// Fetch image buffer from storage
			const imageBuffer = await storage.getImageBuffer(filename, { variant });

			// Set appropriate content type
			res.setHeader('Content-Type', 'image/png');
			res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
			res.send(imageBuffer);
		} catch (error) {
			console.error("Error serving image:", error);
			if (error.message && error.message.includes("not found")) {
				return res.status(404).json({ error: "Image not found" });
			}
			return res.status(500).json({ error: "Failed to serve image" });
		}
	});

	async function requireUser(req, res) {
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

	function parseMeta(raw) {
		if (raw == null) return null;
		if (typeof raw === "object") return raw;
		if (typeof raw !== "string") return null;
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	}

	function nowIso() {
		return new Date().toISOString();
	}

	// POST /api/create - Create a new image
	router.post("/api/create", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const { server_id, method, args, creation_token } = req.body;

		// Validate required fields
		if (!server_id || !method) {
			return res.status(400).json({
				error: "Missing required fields",
				message: "server_id and method are required"
			});
		}

		if (typeof creation_token !== "string" || creation_token.trim().length < 10) {
			return res.status(400).json({
				error: "Missing required fields",
				message: "creation_token is required"
			});
		}

		try {
			// Fetch server
			const server = await queries.selectServerById.get(server_id);
			if (!server) {
				return res.status(404).json({ error: "Server not found" });
			}

			if (server.status !== 'active') {
				return res.status(400).json({ error: "Server is not active" });
			}

			// Parse server_config and validate method
			if (!server.server_config || !server.server_config.methods) {
				return res.status(400).json({ error: "Server configuration is invalid" });
			}

			const methodConfig = server.server_config.methods[method];
			if (!methodConfig) {
				return res.status(400).json({
					error: "Method not available",
					message: `Method "${method}" is not available on this server`,
					available_methods: Object.keys(server.server_config.methods)
				});
			}

			// Get credit cost from method config
			const CREATION_CREDIT_COST = methodConfig.credits ?? 0.5;

			// Check user's credit balance
			let credits = await queries.selectUserCredits.get(user.id);

			// Initialize credits if record doesn't exist
			if (!credits) {
				await queries.insertUserCredits.run(user.id, 100, null);
				credits = await queries.selectUserCredits.get(user.id);
			}

			// Check if user has sufficient credits
			if (!credits || credits.balance < CREATION_CREDIT_COST) {
				return res.status(402).json({
					error: "Insufficient credits",
					message: `Creation requires ${CREATION_CREDIT_COST} credits. You have ${credits?.balance ?? 0} credits.`,
					required: CREATION_CREDIT_COST,
					current: credits?.balance ?? 0
				});
			}

			// Deduct credits before creating the image
			await queries.updateUserCreditsBalance.run(user.id, -CREATION_CREDIT_COST);

			const started_at = nowIso();
			const timeout_at = new Date(Date.now() + PROVIDER_TIMEOUT_MS + 2000).toISOString();

			// Insert a durable row BEFORE provider call.
			const placeholderFilename = `creating_${user.id}_${Date.now()}.png`;
			const meta = {
				creation_token: creation_token.trim(),
				server_id: Number(server_id),
				server_name: typeof server.name === "string" ? server.name : null,
				server_url: server.server_url,
				method,
				method_name: typeof methodConfig.name === "string" && methodConfig.name.trim()
					? methodConfig.name.trim()
					: null,
				args: args || {},
				started_at,
				timeout_at,
				credit_cost: CREATION_CREDIT_COST,
			};

			const result = await queries.insertCreatedImage.run(
				user.id,
				placeholderFilename,
				"", // file_path placeholder (schema requires non-null)
				1024,
				1024,
				null,
				"creating",
				meta
			);

			const createdImageId = result.insertId;

			await scheduleCreationJob({
				payload: {
					created_image_id: createdImageId,
					user_id: user.id,
					server_id: Number(server_id),
					method,
					args: args || {},
					credit_cost: CREATION_CREDIT_COST,
				},
				runCreationJob: ({ payload }) => runCreationJob({ queries, storage, payload }),
			});

			const updatedCredits = await queries.selectUserCredits.get(user.id);

			return res.json({
				id: createdImageId,
				status: "creating",
				created_at: started_at,
				meta,
				credits_remaining: updatedCredits?.balance ?? 0
			});
		} catch (error) {
			console.error("Error initiating image creation:", error);
			return res.status(500).json({ error: "Failed to initiate image creation", message: error.message });
		}
	});

	// POST /api/create/worker - Worker callback (QStash or internal)
	router.post("/api/create/worker", async (req, res) => {
		try {
			// If QStash is configured, require an explicit worker secret to avoid exposing this endpoint.
			if (process.env.UPSTASH_QSTASH_TOKEN) {
				const requiredSecret = process.env.CREATE_WORKER_SECRET;
				const provided = req.get("x-worker-secret");
				if (!requiredSecret || provided !== requiredSecret) {
					return res.status(401).json({ error: "Unauthorized" });
				}
			}

			await runCreationJob({ queries, storage, payload: req.body });
			return res.json({ ok: true });
		} catch (error) {
			console.error("Error running create worker:", error);
			return res.status(500).json({ ok: false, error: "Worker failed" });
		}
	});

	// GET /api/create/images - List all images for user
	router.get("/api/create/images", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const images = await queries.selectCreatedImagesForUser.all(user.id);

			// Transform to include URLs (use file_path from DB which now contains the URL)
			const imagesWithUrls = images.map((img) => {
				const status = img.status || 'completed';
				const url = status === "completed" ? (img.file_path || storage.getImageUrl(img.filename)) : null;
				const meta = parseMeta(img.meta);
				return {
					id: img.id,
					filename: img.filename,
					url,
					thumbnail_url: url ? getThumbnailUrl(url) : null,
					width: img.width,
					height: img.height,
					color: img.color,
					status, // Default to completed for backward compatibility
					created_at: img.created_at,
					published: img.published === 1 || img.published === true,
					published_at: img.published_at || null,
					title: img.title || null,
					description: img.description || null,
					meta
				};
			});

			return res.json({ images: imagesWithUrls });
		} catch (error) {
			console.error("Error fetching images:", error);
			return res.status(500).json({ error: "Failed to fetch images" });
		}
	});

	// GET /api/create/images/:id - Get specific image metadata
	router.get("/api/create/images/:id", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			// First try to get as owner
			let image = await queries.selectCreatedImageById.get(
				req.params.id,
				user.id
			);

			// If not found as owner, check if it exists and is either published or user is admin
			if (!image) {
				const anyImage = await queries.selectCreatedImageByIdAnyUser.get(req.params.id);
				if (anyImage) {
					const isPublished = anyImage.published === 1 || anyImage.published === true;
					const isAdmin = user.role === 'admin';
					if (isPublished || isAdmin) {
						image = anyImage;
					} else {
						return res.status(404).json({ error: "Image not found" });
					}
				} else {
					return res.status(404).json({ error: "Image not found" });
				}
			}

			// Get user information for the creator
			let creator = null;
			if (image.user_id) {
				creator = await queries.selectUserById.get(image.user_id);
			}
			const creatorProfile = image.user_id
				? await queries.selectUserProfileByUserId.get(image.user_id).catch(() => null)
				: null;

			const likeCountRow = await queries.selectCreatedImageLikeCount?.get(image.id);
			const likeCount = Number(likeCountRow?.like_count ?? 0);
			const viewerLikedRow = await queries.selectCreatedImageViewerLiked?.get(user.id, image.id);
			const viewerLiked = Boolean(viewerLikedRow?.viewer_liked);

			const isPublished = image.published === 1 || image.published === true;
			// Always read description from created_image, not from feed_item
			// (feed_item may be deleted when un-publishing)
			const description = typeof image.description === "string" ? image.description.trim() : "";
			const meta = parseMeta(image.meta);

			const status = image.status || 'completed';
			const url = status === "completed"
				? (image.file_path || storage.getImageUrl(image.filename))
				: null;

			return res.json({
				id: image.id,
				filename: image.filename,
				url, // Use stored URL or generate one
				width: image.width,
				height: image.height,
				color: image.color,
				status,
				created_at: image.created_at,
				published: isPublished,
				published_at: image.published_at || null,
				title: image.title || null,
				description: description || null,
				like_count: likeCount,
				viewer_liked: viewerLiked,
				user_id: image.user_id,
				meta,
				creator: creator ? {
					id: creator.id,
					email: creator.email,
					role: creator.role,
					user_name: creatorProfile?.user_name ?? null,
					display_name: creatorProfile?.display_name ?? null,
					avatar_url: creatorProfile?.avatar_url ?? null
				} : null
			});
		} catch (error) {
			console.error("Error fetching image:", error);
			return res.status(500).json({ error: "Failed to fetch image" });
		}
	});

	// POST /api/create/images/:id/retry - "Retry" means: mark stale creating as failed (no provider retry)
	router.post("/api/create/images/:id/retry", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const image = await queries.selectCreatedImageById.get(req.params.id, user.id);
			if (!image) {
				return res.status(404).json({ error: "Image not found" });
			}

			const meta = parseMeta(image.meta) || {};
			const status = image.status || "completed";
			const timeoutAt = meta?.timeout_at ? new Date(meta.timeout_at).getTime() : NaN;
			const isPastTimeout = Number.isFinite(timeoutAt) && Date.now() > timeoutAt;

			if (status === "completed") {
				return res.status(400).json({ error: "Cannot retry a completed image" });
			}

			if (status === "creating" && !isPastTimeout) {
				return res.status(400).json({ error: "Creation is still in progress" });
			}

			const nextMeta = {
				...meta,
				failed_at: nowIso(),
				error_code: meta?.error_code || (status === "creating" ? "timeout" : "provider_error"),
				error: meta?.error || (status === "creating" ? "Timed out" : "Failed"),
			};

			await queries.updateCreatedImageJobFailed.run(Number(req.params.id), user.id, { meta: nextMeta });

			// If it was stuck creating and credits were never refunded, refund once.
			const creditCost = Number(nextMeta?.credit_cost ?? 0);
			if (status === "creating" && creditCost > 0 && nextMeta.credits_refunded !== true) {
				await queries.updateUserCreditsBalance.run(user.id, creditCost);
				await queries.updateCreatedImageJobFailed.run(Number(req.params.id), user.id, {
					meta: { ...nextMeta, credits_refunded: true }
				});
			}

			return res.json({ ok: true });
		} catch (error) {
			console.error("Error retrying image:", error);
			return res.status(500).json({ error: "Failed to retry image" });
		}
	});

	// POST /api/create/images/:id/publish - Publish a creation
	router.post("/api/create/images/:id/publish", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const { title, description } = req.body;

			if (!title || title.trim() === '') {
				return res.status(400).json({ error: "Title is required" });
			}

			// Get the image to verify ownership and status
			const image = await queries.selectCreatedImageById.get(
				req.params.id,
				user.id
			);

			if (!image) {
				return res.status(404).json({ error: "Image not found" });
			}

			if (image.status !== 'completed') {
				return res.status(400).json({ error: "Image must be completed before publishing" });
			}

			if (image.published === 1 || image.published === true) {
				return res.status(400).json({ error: "Image is already published" });
			}

			// Publish the image
			const publishResult = await queries.publishCreatedImage.run(
				req.params.id,
				user.id,
				title.trim(),
				description ? description.trim() : null
			);

			if (publishResult.changes === 0) {
				return res.status(500).json({ error: "Failed to publish image" });
			}

			// Create feed item
			await queries.insertFeedItem.run(
				title.trim(),
				description ? description.trim() : '',
				user.email || 'User',
				null, // tags
				parseInt(req.params.id)
			);

			// Get updated image
			const updatedImage = await queries.selectCreatedImageById.get(
				req.params.id,
				user.id
			);

			return res.json({
				id: updatedImage.id,
				filename: updatedImage.filename,
				url: updatedImage.file_path || storage.getImageUrl(updatedImage.filename), // Use stored URL or generate one
				width: updatedImage.width,
				height: updatedImage.height,
				color: updatedImage.color,
				status: updatedImage.status || 'completed',
				created_at: updatedImage.created_at,
				published: true,
				published_at: updatedImage.published_at,
				title: updatedImage.title,
				description: updatedImage.description
			});
		} catch (error) {
			console.error("Error publishing image:", error);
			return res.status(500).json({ error: "Failed to publish image" });
		}
	});

	// PUT /api/create/images/:id - Update a creation's title/description
	router.put("/api/create/images/:id", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const { title, description } = req.body;

			if (!title || title.trim() === '') {
				return res.status(400).json({ error: "Title is required" });
			}

			// Get the image to verify ownership or admin status
			const image = await queries.selectCreatedImageById.get(
				req.params.id,
				user.id
			);

			// If not found as owner, check if it exists and user is admin
			let anyImage = null;
			if (!image) {
				anyImage = await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);
				if (!anyImage) {
					return res.status(404).json({ error: "Image not found" });
				}
				// Only admins can edit images they don't own
				if (user.role !== 'admin') {
					return res.status(403).json({ error: "Forbidden: You can only edit your own creations" });
				}
			}

			const targetImage = image || anyImage;
			const isPublished = targetImage.published === 1 || targetImage.published === true;

			if (!isPublished) {
				return res.status(400).json({ error: "Can only edit published creations" });
			}

			const isAdmin = user.role === 'admin';
			const isOwner = image && image.user_id === user.id;

			// Update the image
			const updateResult = await queries.updateCreatedImage.run(
				req.params.id,
				user.id,
				title.trim(),
				description ? description.trim() : null,
				isAdmin
			);

			if (updateResult.changes === 0) {
				return res.status(500).json({ error: "Failed to update image" });
			}

			// Update the associated feed item if it exists
			const feedItem = await queries.selectFeedItemByCreatedImageId?.get(parseInt(req.params.id));
			if (feedItem) {
				await queries.updateFeedItem?.run(
					parseInt(req.params.id),
					title.trim(),
					description ? description.trim() : ''
				);
			}

			// Get updated image
			const updatedImage = isOwner
				? await queries.selectCreatedImageById.get(req.params.id, user.id)
				: await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);

			return res.json({
				id: updatedImage.id,
				filename: updatedImage.filename,
				url: updatedImage.file_path || storage.getImageUrl(updatedImage.filename),
				width: updatedImage.width,
				height: updatedImage.height,
				color: updatedImage.color,
				status: updatedImage.status || 'completed',
				created_at: updatedImage.created_at,
				published: updatedImage.published === 1 || updatedImage.published === true,
				published_at: updatedImage.published_at,
				title: updatedImage.title,
				description: updatedImage.description
			});
		} catch (error) {
			console.error("Error updating image:", error);
			return res.status(500).json({ error: "Failed to update image" });
		}
	});

	// POST /api/create/images/:id/unpublish - Un-publish a creation
	router.post("/api/create/images/:id/unpublish", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			// Get the image to verify ownership or admin status
			const image = await queries.selectCreatedImageById.get(
				req.params.id,
				user.id
			);

			// If not found as owner, check if it exists and user is admin
			let anyImage = null;
			if (!image) {
				anyImage = await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);
				if (!anyImage) {
					return res.status(404).json({ error: "Image not found" });
				}
				// Only admins can unpublish images they don't own
				if (user.role !== 'admin') {
					return res.status(403).json({ error: "Forbidden: You can only unpublish your own creations" });
				}
			}

			const targetImage = image || anyImage;
			const isPublished = targetImage.published === 1 || targetImage.published === true;

			if (!isPublished) {
				return res.status(400).json({ error: "Image is not published" });
			}

			const isAdmin = user.role === 'admin';
			const isOwner = image && image.user_id === user.id;

			// Un-publish the image
			const unpublishResult = await queries.unpublishCreatedImage.run(
				req.params.id,
				user.id,
				isAdmin
			);

			if (unpublishResult.changes === 0) {
				return res.status(500).json({ error: "Failed to unpublish image" });
			}

			// Delete the associated feed item if it exists
			if (queries.deleteFeedItemByCreatedImageId) {
				await queries.deleteFeedItemByCreatedImageId.run(parseInt(req.params.id));
			}

			// Delete all likes for this created image
			if (queries.deleteAllLikesForCreatedImage) {
				await queries.deleteAllLikesForCreatedImage.run(parseInt(req.params.id));
			}

			// Delete all comments for this created image
			if (queries.deleteAllCommentsForCreatedImage) {
				await queries.deleteAllCommentsForCreatedImage.run(parseInt(req.params.id));
			}

			// Get updated image
			const updatedImage = isOwner
				? await queries.selectCreatedImageById.get(req.params.id, user.id)
				: await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);

			return res.json({
				id: updatedImage.id,
				filename: updatedImage.filename,
				url: updatedImage.file_path || storage.getImageUrl(updatedImage.filename),
				width: updatedImage.width,
				height: updatedImage.height,
				color: updatedImage.color,
				status: updatedImage.status || 'completed',
				created_at: updatedImage.created_at,
				published: false,
				published_at: null,
				title: updatedImage.title,
				description: updatedImage.description
			});
		} catch (error) {
			console.error("Error unpublishing image:", error);
			return res.status(500).json({ error: "Failed to unpublish image" });
		}
	});

	// DELETE /api/create/images/:id - Delete a creation
	router.delete("/api/create/images/:id", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			// Get the image to verify ownership
			const image = await queries.selectCreatedImageById.get(
				req.params.id,
				user.id
			);

			if (!image) {
				return res.status(404).json({ error: "Image not found" });
			}

			// Check if image is published - cannot delete published images
			if (image.published === 1 || image.published === true) {
				return res.status(400).json({ error: "Cannot delete published images" });
			}

			// Allow delete for failed, or creating past timeout, or unpublished completed.
			const meta = parseMeta(image.meta);
			const status = image.status || "completed";
			if (status === "creating") {
				const timeoutAt = meta?.timeout_at ? new Date(meta.timeout_at).getTime() : NaN;
				if (!Number.isFinite(timeoutAt) || Date.now() <= timeoutAt) {
					return res.status(400).json({ error: "Cannot delete an in-progress creation" });
				}
			}

			// Delete the image file from storage
			try {
				// Only delete underlying file if we actually have one.
				if (image.filename && image.file_path) {
					await storage.deleteImage(image.filename);
				}
			} catch (storageError) {
				// Log but don't fail if file doesn't exist
				console.warn(`Warning: Could not delete image file ${image.filename}:`, storageError.message);
			}

			// Delete the database record
			const deleteResult = await queries.deleteCreatedImageById.run(
				req.params.id,
				user.id
			);

			if (deleteResult.changes === 0) {
				return res.status(500).json({ error: "Failed to delete image" });
			}

			return res.json({ success: true, message: "Image deleted successfully" });
		} catch (error) {
			console.error("Error deleting image:", error);
			return res.status(500).json({ error: "Failed to delete image" });
		}
	});

	return router;
}
