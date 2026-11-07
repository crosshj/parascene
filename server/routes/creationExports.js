import express from "express";
import path from "node:path";
import { resolveCreationImageForExport } from "../services/account/resolveCreationImageForExport.js";
import { resolveCreatedImageStorageFilename } from "../services/create/resolveCreatedImageStorageFilename.js";
import { applyVynlyShareWatermark } from "../services/vynly/vynlyShareWatermark.js";
import { creationRowIsVideo } from "../services/vynly/vynlyShareFromCreation.js";

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

export default function createCreationExportRoutes({ queries, storage }) {
	const router = express.Router();

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
				const watermark = watermarked ? await applyVynlyShareWatermark(source) : null;
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
