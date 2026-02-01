import express from "express";
import sharp from "sharp";
import { verifyShareToken } from "./utils/shareLink.js";

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
			const png = await ensurePngBuffer(buf);
			res.setHeader("Content-Type", "image/png");
			res.setHeader("Cache-Control", "no-store");
			return res.send(png);
		} catch {
			return res.status(500).json({ error: "Failed to serve image" });
		}
	});

	return router;
}

