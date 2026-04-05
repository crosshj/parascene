import express from "express";
import sharp from "sharp";
import { verifyShareToken } from "./utils/shareLink.js";

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

/**
 * @param {object | null} videoMeta - meta.video
 * @returns {string | null} storage key for getVideoBuffer, e.g. video/123_456_....mp4
 */
function videoFilenameFromMeta(videoMeta) {
	if (!videoMeta || typeof videoMeta !== "object") return null;
	if (typeof videoMeta.filename === "string" && videoMeta.filename.startsWith("video/")) {
		return videoMeta.filename;
	}
	const fp = typeof videoMeta.file_path === "string" ? videoMeta.file_path.trim() : "";
	if (fp.startsWith("/api/videos/created/")) {
		return fp.slice("/api/videos/created/".length);
	}
	return null;
}

function isPng(buffer) {
	return (
		buffer &&
		Buffer.isBuffer(buffer) &&
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	);
}

async function ensurePngBuffer(buffer) {
	if (isPng(buffer)) return buffer;
	return await sharp(buffer, { failOn: "none" }).png().toBuffer();
}

function parseVariant(raw) {
	const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (value === "wide" || value === "card") return "wide";
	return "raw";
}

async function toWideCardPng(buffer) {
	// X/OG-friendly card: 1200×675
	const targetWidth = 1200;
	const targetHeight = 675;

	// Your pipeline note: upscale to 1200×1200 then crop a 675px-tall middle slice.
	const square = 1200;
	const top = Math.floor((square - targetHeight) / 2);

	return await sharp(buffer, { failOn: "none" })
		.resize(square, square, { fit: "cover", position: "centre" })
		.extract({ left: 0, top, width: square, height: targetHeight })
		.png()
		.toBuffer();
}

export default function createShareRoutes({ queries, storage }) {
	const router = express.Router();

	router.get("/api/share/:version/:token/image", async (req, res) => {
		const version = String(req.params.version || "");
		const token = String(req.params.token || "");
		const variant = parseVariant(req.query?.variant);
		const hasCacheBust = typeof req.query?.v === "string" && req.query.v.trim().length > 0;

		const verified = verifyShareToken({ version, token });
		if (!verified.ok) {
			return res.status(404).json({ error: "Not found" });
		}

		try {
			const image = await queries.selectCreatedImageByIdAnyUser?.get(verified.imageId);
			if (!image) {
				return res.status(404).json({ error: "Not found" });
			}
			const status = image.status || "completed";
			if (status !== "completed") {
				return res.status(404).json({ error: "Not found" });
			}
			if (!image.filename) {
				return res.status(404).json({ error: "Not found" });
			}

			const buf = await storage.getImageBuffer(image.filename);
			const basePng = await ensurePngBuffer(buf);
			const png = variant === "wide" ? await toWideCardPng(basePng) : basePng;
			res.setHeader("Content-Type", "image/png");
			// If callers include a cache-bust query param, we can safely cache aggressively.
			res.setHeader("Cache-Control", hasCacheBust ? "public, max-age=31536000, immutable" : "public, max-age=3600");
			return res.send(png);
		} catch {
			return res.status(500).json({ error: "Failed to serve image" });
		}
	});

	// GET /api/share/:version/:token/video — same token as /image; streams creation video for share links (no session cookie required).
	router.get("/api/share/:version/:token/video", async (req, res) => {
		const version = String(req.params.version || "");
		const token = String(req.params.token || "");

		const verified = verifyShareToken({ version, token });
		if (!verified.ok) {
			return res.status(404).json({ error: "Not found" });
		}

		if (typeof storage?.getVideoBuffer !== "function") {
			return res.status(503).json({ error: "Video not available" });
		}

		try {
			const image = await queries.selectCreatedImageByIdAnyUser?.get(verified.imageId);
			if (!image) {
				return res.status(404).json({ error: "Not found" });
			}
			const status = image.status || "completed";
			if (status !== "completed") {
				return res.status(404).json({ error: "Not found" });
			}

			const meta = parseMeta(image.meta);
			const mediaType = typeof meta?.media_type === "string" ? meta.media_type : "image";
			const videoMeta = meta && typeof meta === "object" ? meta.video : null;
			if (mediaType !== "video" || !videoMeta) {
				return res.status(404).json({ error: "Not found" });
			}

			const filename = videoFilenameFromMeta(videoMeta);
			if (!filename) {
				return res.status(404).json({ error: "Not found" });
			}

			let contentType = "video/mp4";
			if (typeof videoMeta.content_type === "string" && videoMeta.content_type) {
				contentType = videoMeta.content_type;
			}

			const videoBuffer = await storage.getVideoBuffer(filename);
			const size = videoBuffer.length;
			const rangeRaw = typeof req.headers.range === "string" ? req.headers.range.trim() : "";
			const rangeMatch = /^bytes=(\d+)-(\d*)$/.exec(rangeRaw);
			if (rangeMatch && size > 0) {
				const start = parseInt(rangeMatch[1], 10);
				let end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : size - 1;
				if (!Number.isFinite(start) || start < 0 || start >= size) {
					return res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
				}
				if (!Number.isFinite(end) || end >= size) end = size - 1;
				if (start > end) {
					return res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
				}
				const chunk = videoBuffer.subarray(start, end + 1);
				res.status(206);
				res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
				res.setHeader("Content-Length", String(chunk.length));
				res.setHeader("Content-Type", contentType);
				res.setHeader("Cache-Control", "public, max-age=3600");
				res.setHeader("Accept-Ranges", "bytes");
				return res.send(chunk);
			}

			res.setHeader("Content-Type", contentType);
			res.setHeader("Content-Length", String(size));
			res.setHeader("Cache-Control", "public, max-age=3600");
			res.setHeader("Accept-Ranges", "bytes");
			return res.send(videoBuffer);
		} catch {
			return res.status(500).json({ error: "Failed to serve video" });
		}
	});

	return router;
}

