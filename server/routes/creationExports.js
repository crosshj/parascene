import express from "express";
import path from "node:path";
import { resolveCreationImageForExport } from "../services/account/resolveCreationImageForExport.js";
import { resolveCreatedImageStorageFilename } from "../services/create/resolveCreatedImageStorageFilename.js";
import { applyImageWatermark } from "../services/create/imageWatermark.js";
import { creationRowIsVideo } from "../services/create/creationMedia.js";
import { createWatermarkedVideoCache } from "../services/create/watermarkedVideoCache.js";

function imageContentType(filename) {
	const extension = path.extname(String(filename || "")).toLowerCase();
	return ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif" })[extension] || "image/png";
}

function sendImage(res, buffer, contentType, filename) {
	res.set({
		"Cache-Control": "private, no-store, max-age=0",
		"Content-Type": contentType,
		"Content-Length": String(buffer.length),
		"Content-Disposition": `inline; filename="${filename}"`
	});
	return res.send(buffer);
}

export default function createCreationExportRoutes({ queries, storage, watermarkedVideoCache }) {
	const router = express.Router();
	const videoCache = watermarkedVideoCache || createWatermarkedVideoCache({ storage });

	async function sendWatermarkedVideo(req, res, next) {
		try {
			await videoCache.init();
			const job = videoCache.get(req.params.jobId);
			if (!job || job.status !== "ready") return res.status(404).json({ error: "Video unavailable" });
			res.set("Cache-Control", "no-store");
			return res.sendFile(job.path, { acceptRanges: true, cacheControl: false });
		} catch (error) { return next(error); }
	}
	router.get("/api/share/watermarked-video/:jobId", sendWatermarkedVideo);
	router.head("/api/share/watermarked-video/:jobId", sendWatermarkedVideo);

	async function resolveForRequest(req, res) {
		if (!req.auth?.userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}
		const user = await queries.selectUserById.get(req.auth.userId);
		if (!user) {
			res.status(404).json({ error: "User not found" });
			return null;
		}
		const resolved = await resolveCreationImageForExport({ queries, creationId: req.params.id, user });
		if (!resolved.ok) {
			res.status(resolved.status).json({ error: resolved.error });
			return null;
		}
		const filename = resolveCreatedImageStorageFilename(resolved.image);
		if (!filename) {
			res.status(400).json({ error: "Image file missing" });
			return null;
		}
		return { id: Number(req.params.id), image: resolved.image, filename };
	}

	router.post("/api/create/images/:id/watermarked-video/prepare", async (req, res, next) => {
		try {
			const resolved = await resolveForRequest(req, res);
			if (!resolved) return;
			if (!creationRowIsVideo(resolved.image.meta)) return res.status(400).json({ error: "Creation is not a video" });
			const job = await videoCache.prepare({ image: resolved.image, userId: req.auth.userId });
			return res.status(202).json(job);
		} catch (error) {
			if (Number.isInteger(error?.status)) return res.status(error.status).json({ error: error.message });
			return next(error);
		}
	});

	router.get("/api/create/watermarked-video/:jobId", async (req, res, next) => {
		try {
			if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
			await videoCache.init();
			const job = videoCache.get(req.params.jobId);
			if (!job || job.userId !== Number(req.auth.userId)) return res.status(404).json({ error: "Preparation unavailable" });
			return res.json({ status: job.status, error: job.error || undefined,
				url: job.status === "ready" ? videoCache.preparedUrl(job.id, req.auth.userId, job.creationId) : undefined });
		} catch (error) { return next(error); }
	});

	for (const [route, watermarked] of [["/api/create/images/:id/image", false], ["/api/create/images/:id/watermarked", true]]) {
		router.get(route, async (req, res, next) => {
			try {
				const resolved = await resolveForRequest(req, res);
				if (!resolved) return;
				if (watermarked && creationRowIsVideo(resolved.image.meta)) {
					return res.status(400).json({ error: "Video creations are not supported for watermarked export" });
				}
				const source = await storage.getImageBuffer(resolved.filename);
				if (!Buffer.isBuffer(source)) return res.status(500).json({ error: "Failed to read image" });
				const watermark = watermarked ? await applyImageWatermark(source) : null;
				const buffer = watermark?.buffer && Buffer.isBuffer(watermark.buffer) ? watermark.buffer : source;
				const contentType = watermark?.contentType || imageContentType(resolved.filename);
				const suffix = watermark?.filenameSuffix || ({ "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" })[contentType] || ".png";
				const name = `parascene-${resolved.id}${watermarked ? "-watermarked" : ""}${suffix}`;
				return sendImage(res, buffer, contentType, name);
			} catch (error) {
				return next(error);
			}
		});
	}
	return router;
}
