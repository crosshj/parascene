import express from "express";
import path from "path";
import sharp from "sharp";
import { CHAT_UPLOAD_MAX_BYTES } from "../src/shared/chatUploadMaxBytes.js";
import { isChatMiscGenericKeyOwnedByUser, safeDecodeGenericImageKeyTail } from "./utils/chatMiscGenericKeys.js";
import { sendBufferWithRangeSupport } from "./utils/sendBufferWithRangeSupport.js";

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

function parseShareAudioCreationIdFromKey(key) {
	const raw = String(key || "");
	if (!raw.startsWith("share-audio/")) return null;
	const baseName = raw.split("/").pop() || "";
	const withoutExt = baseName.replace(/\.[^.]+$/, "");
	const parts = withoutExt.split("_");
	const creationId = Number(parts[1]);
	return Number.isFinite(creationId) && creationId > 0 ? creationId : null;
}

function guessContentType(key, hintedName = "") {
	const rawKey = String(key || "");
	const keyExt = path.extname(rawKey).toLowerCase();
	const hintExt = path.extname(String(hintedName || "")).toLowerCase();
	const ext = hintExt || keyExt;
	if (rawKey.startsWith("share-audio/")) {
		if (ext === ".webm") return "audio/webm";
		if (ext === ".ogg") return "audio/ogg";
		if (ext === ".m4a" || ext === ".mp4") return "audio/mp4";
	}
	if (ext === ".html" || ext === ".htm") return "text/html; charset=utf-8";
	if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
	if (ext === ".webp") return "image/webp";
	if (ext === ".gif") return "image/gif";
	if (ext === ".svg") return "image/svg+xml";
	if (ext === ".png") return "image/png";
	if (ext === ".heic" || ext === ".heif") return "image/heif";
	if (ext === ".tif" || ext === ".tiff") return "image/tiff";
	if (ext === ".jxl") return "image/jxl";
	if (ext === ".avif") return "image/avif";
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
	if (ct.includes("image/heic") || ct.includes("image/heif")) return ".heic";
	if (ct.includes("image/tiff") || ct === "image/tif") return ".tiff";
	if (ct.includes("image/jxl") || ct.includes("jpeg-xl")) return ".jxl";
	if (ct.includes("video/mp4")) return ".mp4";
	if (ct.includes("video/webm")) return ".webm";
	if (ct.includes("video/quicktime")) return ".mov";
	if (ct.includes("audio/webm")) return ".webm";
	if (ct.includes("audio/ogg")) return ".ogg";
	if (ct.includes("audio/mp4")) return ".m4a";
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

/** Max edge when transcoding HEIC/TIFF/JXL so huge phone photos stay bounded. */
const GENERIC_TRANSCODE_MAX_EDGE = 4096;

/**
 * Filename extensions we treat as images when Content-Type is missing (e.g. some HEIC picks).
 */
const IMAGE_UPLOAD_FILENAME_EXTS = new Set([
	".avif",
	".bmp",
	".gif",
	".heic",
	".heif",
	".ico",
	".jpeg",
	".jpg",
	".jxl",
	".png",
	".svg",
	".tif",
	".tiff",
	".webp"
]);

/**
 * Raster formats with poor or inconsistent <img> support in major browsers (Chrome/Firefox);
 * transcode to WebP on generic upload only for these.
 */
const EXT_NEEDS_WEB_TRANSCODE = new Set([".heic", ".heif", ".jxl", ".tif", ".tiff"]);

function isImageContentType(contentType) {
	return String(contentType || "").toLowerCase().startsWith("image/");
}

function filenameExtSuggestsImageUpload(originalName) {
	const ext = path.extname(String(originalName || "")).toLowerCase();
	return IMAGE_UPLOAD_FILENAME_EXTS.has(ext);
}

function contentTypeNeedsBrowserSafeTranscode(contentType) {
	const t = String(contentType || "").toLowerCase();
	if (!t.startsWith("image/")) return false;
	if (t.includes("heic") || t.includes("heif")) return true;
	if (t === "image/tiff" || t === "image/tif" || t.includes("image/tiff")) return true;
	if (t === "image/jxl" || t.includes("jpeg-xl")) return true;
	return false;
}

function uploadNeedsBrowserSafeTranscode(originalName, contentType) {
	const ext = path.extname(String(originalName || "")).toLowerCase();
	if (EXT_NEEDS_WEB_TRANSCODE.has(ext)) return true;
	return contentTypeNeedsBrowserSafeTranscode(contentType);
}

async function transcodeGenericUploadToWebp(buffer) {
	const meta = await sharp(buffer).metadata();
	const w = meta.width;
	const h = meta.height;
	let pipeline = sharp(buffer).rotate();
	if (
		typeof w === "number" &&
		typeof h === "number" &&
		(w > GENERIC_TRANSCODE_MAX_EDGE || h > GENERIC_TRANSCODE_MAX_EDGE)
	) {
		pipeline = pipeline.resize({
			width: GENERIC_TRANSCODE_MAX_EDGE,
			height: GENERIC_TRANSCODE_MAX_EDGE,
			fit: "inside",
			withoutEnlargement: true
		});
	}
	return pipeline.webp({ quality: 85 }).toBuffer();
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

		if (key.startsWith("share-audio/")) {
			try {
				if (!storage?.getGenericImageBuffer) {
					return res.status(500).json({ error: "Generic images storage not available" });
				}

				const creationId = parseShareAudioCreationIdFromKey(key);
				if (!creationId) {
					return res.status(404).json({ error: "Audio not found" });
				}

				const image = await queries.selectCreatedImageByIdAnyUser?.get(creationId);
				if (!image) {
					return res.status(404).json({ error: "Audio not found" });
				}

				const meta = parseMeta(image.meta) || {};
				const shareAudio = meta.share_audio && typeof meta.share_audio === "object" ? meta.share_audio : null;
				const storedKey = typeof shareAudio?.key === "string" ? shareAudio.key.trim() : "";
				if (!storedKey || storedKey !== key) {
					return res.status(404).json({ error: "Audio not found" });
				}

				const userId = req.auth?.userId;
				const isOwner = userId && Number(image.user_id) === Number(userId);
				const isPublished = image.published === 1 || image.published === true;
				let isAdmin = false;
				if (userId && !isOwner && !isPublished) {
					try {
						const user = await queries.selectUserById.get(userId);
						isAdmin = user?.role === "admin";
					} catch {
						isAdmin = false;
					}
				}

				if (!isPublished && !isOwner && !isAdmin) {
					if (!userId) {
						return res.status(401).json({ error: "Unauthorized" });
					}
					return res.status(403).json({ error: "Access denied" });
				}

				const buffer = await storage.getGenericImageBuffer(key);
				const contentType =
					typeof shareAudio.content_type === "string" && shareAudio.content_type
						? shareAudio.content_type
						: guessContentType(key, hintedName);
				return sendBufferWithRangeSupport(res, buffer, {
					contentType,
					cacheControl: "public, max-age=3600",
					rangeHeader: typeof req.headers.range === "string" ? req.headers.range : "",
				});
			} catch (error) {
				const message = String(error?.message || "");
				if (message.toLowerCase().includes("not found")) {
					return res.status(404).json({ error: "Audio not found" });
				}
				return res.status(500).json({ error: "Failed to serve audio" });
			}
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
			const uploadIsImage =
				isImageContentType(contentType) || filenameExtSuggestsImageUpload(originalName);
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
			let ext = path.extname(originalName) || extFromContentType(contentType) || extFallback;
			let outContentType = contentType;

			const now = Date.now();
			const rand = Math.random().toString(36).slice(2, 9);
			const userPart = safeKeySegment(String(req.auth.userId));

			let displayAsFile = false;

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
			} else if (kind === "generic" && uploadNeedsBrowserSafeTranscode(originalName, contentType)) {
				try {
					buffer = await transcodeGenericUploadToWebp(buffer);
					ext = ".webp";
					outContentType = "image/webp";
				} catch (err) {
					// No HEIF/libheif etc. on host: keep original bytes as misc_* (not generic_*).
					// Started as generic, so founder misc gate above did not run — safe for normal users.
					console.warn("[POST /api/images/generic] browser-safe transcode failed; storing as misc", {
						name: originalName,
						message: String(err?.message || err)
					});
					kind = "misc";
					ext = path.extname(originalName) || extFromContentType(contentType) || ".bin";
					outContentType = isImageContentType(contentType)
						? contentType
						: "application/octet-stream";
					displayAsFile = true;
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
					contentType: kind === "edited" ? "image/png" : outContentType
				});
				return res.json({
					ok: true,
					key: storedKey,
					max_bytes: CHAT_UPLOAD_MAX_BYTES,
					url: buildImageUrl("generic", storedKey),
					...(displayAsFile ? { display_as_file: true } : {})
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

