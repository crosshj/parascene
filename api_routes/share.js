import express from "express";
import path from "path";
import { verifyShareToken } from "./utils/shareLink.js";

function guessImageContentType({ filename, buffer }) {
	const ext = path.extname(String(filename || "")).toLowerCase();
	if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
	if (ext === ".webp") return "image/webp";
	if (ext === ".gif") return "image/gif";
	if (ext === ".svg") return "image/svg+xml";
	if (ext === ".png") return "image/png";

	// Fallback: sniff common magic numbers (more reliable than extension).
	if (buffer && Buffer.isBuffer(buffer) && buffer.length >= 12) {
		// JPEG: FF D8 FF
		if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";

		// PNG: 89 50 4E 47 0D 0A 1A 0A
		if (
			buffer[0] === 0x89 &&
			buffer[1] === 0x50 &&
			buffer[2] === 0x4e &&
			buffer[3] === 0x47 &&
			buffer[4] === 0x0d &&
			buffer[5] === 0x0a &&
			buffer[6] === 0x1a &&
			buffer[7] === 0x0a
		) {
			return "image/png";
		}

		// GIF: "GIF87a" or "GIF89a"
		const ascii6 = buffer.subarray(0, 6).toString("ascii");
		if (ascii6 === "GIF87a" || ascii6 === "GIF89a") return "image/gif";

		// WebP: "RIFF" .... "WEBP"
		if (
			buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
			buffer.subarray(8, 12).toString("ascii") === "WEBP"
		) {
			return "image/webp";
		}
	}

	// Default: keep existing behavior (most common).
	return "image/png";
}

export default function createShareRoutes({ queries, storage }) {
	const router = express.Router();

	router.get("/api/share/:version/:token/image", async (req, res) => {
		const version = String(req.params.version || "");
		const token = String(req.params.token || "");
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
			res.setHeader("Content-Type", guessImageContentType({ filename: image.filename, buffer: buf }));
			res.setHeader("Cache-Control", "no-store");
			return res.send(buf);
		} catch {
			return res.status(500).json({ error: "Failed to serve image" });
		}
	});

	return router;
}

