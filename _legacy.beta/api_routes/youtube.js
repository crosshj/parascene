import express from "express";
import {
	extractYoutubeVideoId,
	normalizeYoutubeUrl,
	resolveYoutubeVideoFromUrl,
} from "./utils/youtubeResolve.js";

export default function createYoutubeRoutes() {
	const router = express.Router();

	router.get("/api/youtube/oembed", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const url = normalizeYoutubeUrl(req.query?.url);
		if (!url) {
			return res.status(400).json({ error: "Missing url" });
		}

		const videoId = extractYoutubeVideoId(url);
		if (!videoId) {
			return res.status(400).json({ error: "Invalid YouTube url" });
		}

		res.setHeader(
			"Cache-Control",
			"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"
		);

		try {
			const resolved = await resolveYoutubeVideoFromUrl(url);
			if (!resolved.title) {
				return res.status(502).json({ error: "No title returned" });
			}
			return res.json({
				title: resolved.title,
				creator: resolved.creator,
				thumbnail_url: resolved.thumbnailUrl || "",
			});
		} catch (error) {
			return res.status(502).json({ error: "YouTube oEmbed fetch failed" });
		}
	});

	return router;
}
