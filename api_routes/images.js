import express from "express";
import path from "path";
import sharp from "sharp";
import { isChatMiscGenericKeyOwnedByUser, safeDecodeGenericImageKeyTail } from "./utils/chatMiscGenericKeys.js";

function guessContentType(key, hintedName = "") {
	const keyExt = path.extname(String(key || "")).toLowerCase();
	const hintExt = path.extname(String(hintedName || "")).toLowerCase();
	const ext = hintExt || keyExt;
	if (ext === ".html" || ext === ".htm") return "text/html; charset=utf-8";
	if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
	if (ext === ".webp") return "image/webp";
	if (ext === ".gif") return "image/gif";
	if (ext === ".svg") return "image/svg+xml";
	if (ext === ".mp4") return "video/mp4";
	if (ext === ".webm") return "video/webm";
	if (ext === ".mov") return "video/quicktime";
	if (ext === ".m4v") return "video/mp4";
	if (ext === ".pdf") return "application/pdf";
	if (ext === ".txt") return "text/plain; charset=utf-8";
	if (ext === ".json") return "application/json; charset=utf-8";
	if (ext === ".zip") return "application/zip";
	return "application/octet-stream";
}

function normalizeUploadKind(value) {
	const v = String(value || "").toLowerCase().trim();
	if (v === "avatar" || v === "cover" || v === "edited" || v === "generic" || v === "misc") return v;
	return "generic";
}

function safeKeySegment(segment) {
	return String(segment || "")
		.replace(/[^a-z0-9._-]/gi, "_")
		.replace(/_+/g, "_")
		.slice(0, 80);
}

function extFromContentType(contentType) {
	const ct = String(contentType || "").toLowerCase();
	if (ct.includes("text/html")) return ".html";
	if (ct.includes("image/jpeg")) return ".jpg";
	if (ct.includes("image/webp")) return ".webp";
	if (ct.includes("image/gif")) return ".gif";
	if (ct.includes("image/svg+xml")) return ".svg";
	if (ct.includes("image/png")) return ".png";
	if (ct.includes("video/mp4")) return ".mp4";
	if (ct.includes("video/webm")) return ".webm";
	if (ct.includes("video/quicktime")) return ".mov";
	if (ct.includes("application/pdf")) return ".pdf";
	if (ct.includes("text/plain")) return ".txt";
	if (ct.includes("application/json")) return ".json";
	if (ct.includes("application/zip")) return ".zip";
	return "";
}

function buildImageUrl(namespace, key) {
	const ns = encodeURIComponent(String(namespace || ""));
	const segments = String(key || "")
		.split("/")
		.filter(Boolean)
		.map((s) => encodeURIComponent(s));
	return `/api/images/${ns}/${segments.join("/")}`;
}

const CHAT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

function isImageContentType(contentType) {
	return String(contentType || "").toLowerCase().startsWith("image/");
}

export default function createImagesRoutes({ storage, queries }) {
	const router = express.Router();

	async function canUploadNonImageForUser(userId) {
		const uid = Number(userId);
		if (!Number.isFinite(uid) || uid <= 0) return false;
		try {
			if (typeof queries?.selectUserById?.get !== "function") return false;
			const user = await queries.selectUserById.get(uid);
			const role = String(user?.role || "").toLowerCase();
			const plan = String(user?.meta?.plan || "").toLowerCase();
			return role === "admin" || role === "founder" || plan === "founder";
		} catch {
			return false;
		}
	}

	// Delete chat misc paste image (profile/{uid}/generic_*); owner only.
	router.delete("/api/images/:namespace/:key(*)", async (req, res, next) => {
		const namespace = String(req.params.namespace || "").toLowerCase();
		if (namespace !== "generic") return next();

		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized", message: "Login required" });
		}

		if (!storage?.deleteGenericImage) {
			return res.status(500).json({ error: "Storage not available" });
		}

		const rawTail = String(req.params.key || "");
		const key = safeDecodeGenericImageKeyTail(rawTail);
		if (!key) {
			return res.status(400).json({ error: "Invalid key" });
		}

		if (!isChatMiscGenericKeyOwnedByUser(key, req.auth.userId)) {
			return res.status(403).json({ error: "Forbidden", message: "Not allowed to delete this object" });
		}

		try {
			await storage.deleteGenericImage(key);
			return res.status(200).json({ ok: true });
		} catch (err) {
			return res.status(500).json({ error: "Failed to delete", message: err?.message || "Failed" });
		}
	});

	// Generic images namespace (Supabase private bucket: prsn_generic-images)
	router.get("/api/images/:namespace/:key(*)", async (req, res, next) => {
		const namespace = String(req.params.namespace || "").toLowerCase();
		const key = String(req.params.key || "");
		const hintedName = typeof req.query?.name === "string" ? String(req.query.name) : "";

		// Let other routes handle other namespaces (e.g. /api/images/created/:filename).
		if (namespace !== "generic") {
			return next();
		}

		if (!key) {
			return res.status(400).json({ error: "Invalid key" });
		}

		// Public-read subset: profile images (avatars/covers) and edited images (provider fetch) are viewable without auth.
		const isPublicProfileKey =
			key.startsWith("profile/") && !key.includes("..") && !key.startsWith("profile//");
		const isPublicEditedKey =
			key.startsWith("edited/") && !key.includes("..") && !key.startsWith("edited//");
		if (!isPublicProfileKey && !isPublicEditedKey && !req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		try {
			if (!storage?.getGenericImageBuffer) {
				return res.status(500).json({ error: "Generic images storage not available" });
			}

			const buffer = await storage.getGenericImageBuffer(key);
			const contentType = guessContentType(key, hintedName);
			res.setHeader("Content-Type", contentType);
			if (contentType.startsWith("text/html")) {
				res.setHeader("Content-Disposition", "inline");
			}
			res.setHeader("Cache-Control", "public, max-age=3600");
			return res.send(buffer);
		} catch (error) {
			const message = String(error?.message || "");
			if (message.toLowerCase().includes("not found")) {
				return res.status(404).json({ error: "Image not found" });
			}
			// console.error("Error serving generic image:", error);
			return res.status(500).json({ error: "Failed to serve image" });
		}
	});

	// Upload generic chat/profile assets. Body is raw bytes.
	router.post(
		"/api/images/:namespace",
		express.raw({
			type: () => true,
			limit: `${CHAT_UPLOAD_MAX_BYTES}b`
		}),
		async (req, res, next) => {
			const namespace = String(req.params.namespace || "").toLowerCase();
			if (namespace !== "generic") return next();

			if (!req.auth?.userId) {
				return res.status(401).json({
					error: "Unauthorized",
					code: "LOGIN_REQUIRED",
					message: "You must be logged in to upload images."
				});
			}

			if (!storage?.uploadGenericImage) {
				return res.status(500).json({ error: "Generic images storage not available" });
			}

			let buffer = req.body;
			if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
				return res.status(400).json({ error: "Empty upload" });
			}

			let kind = normalizeUploadKind(req.headers["x-upload-kind"]);
			const originalName = String(req.headers["x-upload-name"] || "");
			const contentType = String(req.headers["content-type"] || "application/octet-stream");
			const uploadIsImage = isImageContentType(contentType);
			if (kind === "generic") {
				kind = uploadIsImage ? "generic" : "misc";
			}
			if (kind === "misc") {
				const allowed = await canUploadNonImageForUser(req.auth.userId);
				if (!allowed) {
					return res.status(403).json({
						error: "Forbidden",
						message: "Only founder-level or admin accounts can upload non-image files."
					});
				}
			}
			const extFallback = kind === "misc" ? ".bin" : ".png";
			const ext = path.extname(originalName) || extFromContentType(contentType) || extFallback;

			const now = Date.now();
			const rand = Math.random().toString(36).slice(2, 9);
			const userPart = safeKeySegment(String(req.auth.userId));

			if (kind === "edited") {
				try {
					const meta = await sharp(buffer).metadata();
					if (
						typeof meta.width === "number" &&
						typeof meta.height === "number" &&
						(meta.width !== 1024 || meta.height !== 1024)
					) {
						buffer = await sharp(buffer)
							.resize(1024, 1024, {
								fit: "cover",
								position: "entropy"
							})
							.png()
							.toBuffer();
					} else {
						buffer = await sharp(buffer).png().toBuffer();
					}
				} catch (err) {
					return res.status(400).json({ error: "Invalid image" });
				}
			}

			const key =
				kind === "edited"
					? `edited/${userPart}/${now}_${rand}.png`
					: kind === "misc"
						? `profile/${userPart}/misc_${now}_${rand}${ext}`
					: `profile/${userPart}/${kind}_${now}_${rand}${ext}`;

			try {
				const storedKey = await storage.uploadGenericImage(buffer, key, {
					contentType: kind === "edited" ? "image/png" : contentType
				});
				return res.json({
					ok: true,
					key: storedKey,
					max_bytes: CHAT_UPLOAD_MAX_BYTES,
					url: buildImageUrl("generic", storedKey)
				});
			} catch (error) {
				console.error("[POST /api/images/generic]", error);
				return res.status(500).json({
					error: "Failed to upload image",
					message: error?.message || "Upload failed"
				});
			}
		}
	);

	return router;
}

