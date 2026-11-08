import express from "express";
import QRCode from "qrcode";

export default function createQrRoutes() {
	const router = express.Router();
	router.get("/api/qr", async (req, res, next) => {
		try {
			const url = typeof req.query.url === "string" ? req.query.url : "";
			if (!url) return res.status(400).json({ error: "Missing URL" });
			if (url.length > 2048) return res.status(400).json({ error: "URL too long" });
			const svg = await QRCode.toString(url, { type: "svg", width: 256, margin: 2, errorCorrectionLevel: "M" });
			res.type("image/svg+xml").send(svg);
		} catch (error) {
			next(error);
		}
	});
	return router;
}
