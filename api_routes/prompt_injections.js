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

	/**
	 * GET /api/styles/:slug — one style row visible to the user (library rules).
	 * Used by /styles/:slug detail page.
	 */
	router.get("/api/styles/:slug", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const raw = String(req.params?.slug ?? "").trim();
			const slug = raw.toLowerCase();
			if (!/^[a-z][a-z0-9_-]{0,63}$/.test(slug)) {
				return res.status(400).json({ error: "Invalid style slug" });
			}
			const fn = queries.selectPromptInjectionStyleBySlugForUser?.get;
			if (typeof fn !== "function") {
				return res.status(501).json({ error: "Styles are not available" });
			}
			const row = await fn(req.auth.userId, slug);
			if (!row) {
				return res.status(404).json({ error: "Style not found" });
			}
			res.set("Cache-Control", "private, max-age=60");
			return res.json({
				style: {
					tag: row.tag,
					title: row.title ?? null,
					description: row.description ?? null,
					visibility: row.visibility ?? null,
					injection_text: typeof row.injection_text === "string" ? row.injection_text : null
				}
			});
		} catch (err) {
			console.error("[styles]", err);
			return res.status(500).json({ error: "Failed to load style" });
		}
	});

	return router;
}
