import express from "express";

/**
 * GET /api/prompt-injections — all injections the user may see in the prompt library (single payload; client filters by tag_type).
 * Auth required.
 */
export default function createPromptInjectionsRoutes({ queries }) {
	const router = express.Router();

	router.get("/api/prompt-injections", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const fn = queries.selectPromptInjectionsForLibrary?.all;
			if (typeof fn !== "function") {
				return res.status(501).json({ error: "Prompt library is not available" });
			}
			const items = await fn(req.auth.userId);
			res.set("Cache-Control", "private, max-age=30");
			return res.json({ items: Array.isArray(items) ? items : [] });
		} catch (err) {
			console.error("[prompt-injections]", err);
			return res.status(500).json({ error: "Failed to load prompt library" });
		}
	});

	return router;
}
