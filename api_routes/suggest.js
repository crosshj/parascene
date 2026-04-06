import express from "express";
import { CREATE_STYLES } from "./utils/createStyles.js";

/** Normalize query for prefix search: lowercase, trim, only [a-z0-9_]. Returns empty string if invalid. */
function normalizeSuggestQuery(raw) {
	const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (!s) return "";
	return s.replace(/[^a-z0-9_]/g, "") || "";
}

/** Style slug prefix: allow hyphen in tags. */
function normalizeStylePrefix(raw) {
	const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (!s) return "";
	return s.replace(/[^a-z0-9_-]/g, "") || "";
}

function legacyStyleSuggestItems(prefixLower, limit, usedTags) {
	const out = [];
	for (const key of Object.keys(CREATE_STYLES)) {
		if (key === "none") continue;
		const kl = key.toLowerCase();
		if (!kl.startsWith(prefixLower)) continue;
		if (usedTags.has(kl)) continue;
		usedTags.add(kl);
		const label = CREATE_STYLES[key]?.title != null ? String(CREATE_STYLES[key].title).trim() : key;
		out.push({
			type: "style",
			id: `legacy:${key}`,
			tag: key,
			label: label || key,
			sublabel: `$${key}`,
			insert_text: `$${key} `,
			icon_shape: "square"
		});
		if (out.length >= limit) break;
	}
	return out;
}

/**
 * GET /api/suggest?source=users&q=...&limit=10
 * Generic suggest endpoint for triggered autocomplete (mentions, tags, styles, etc.).
 * Auth required. Returns { items: [{ type, id, label, sublabel?, icon_url?, badge?, insert_text? }] }.
 * Speed: single query, small limit, validate before DB.
 */
export default function createSuggestRoutes({ queries }) {
	const router = express.Router();

	router.get("/api/suggest", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const source = typeof req.query.source === "string" ? req.query.source.trim().toLowerCase() : "";
			const rawQ = typeof req.query.q === "string" ? req.query.q : "";
			const limitParam = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 10), 20);

			if (!source) {
				return res.status(400).json({ error: "Missing source" });
			}

			if (source === "users") {
				const q = normalizeSuggestQuery(rawQ);
				if (!q) {
					res.set("Cache-Control", "private, max-age=60");
					return res.json({ items: [] });
				}
				const search = typeof queries.searchUserProfilesByPrefix === "function"
					? queries.searchUserProfilesByPrefix(q, limitParam)
					: Promise.resolve([]);
				const rows = await search;
				const items = (Array.isArray(rows) ? rows : []).map((row) => {
					const user_name = row?.user_name != null ? String(row.user_name).trim() : "";
					const display_name = row?.display_name != null ? String(row.display_name).trim() : "";
					const label = display_name || user_name || "User";
					const sublabel = user_name ? `@${user_name}` : "";
					const insert_text = user_name ? `@${user_name} ` : "";
					return {
						type: "user",
						id: row?.user_id != null ? String(row.user_id) : "",
						label,
						sublabel: sublabel || undefined,
						icon_url: row?.avatar_url != null ? String(row.avatar_url).trim() || undefined : undefined,
						insert_text: insert_text || undefined
					};
				});
				res.set("Cache-Control", "private, max-age=120");
				return res.json({ items });
			}

			if (source === "styles") {
				const q = normalizeStylePrefix(rawQ);
				if (!q) {
					res.set("Cache-Control", "private, max-age=60");
					return res.json({ items: [] });
				}
				const uid = Number(req.auth.userId);
				const used = new Set();
				const items = [];

				const searchFn = queries.searchPromptInjectionStylesByPrefix?.all;
				if (typeof searchFn === "function") {
					const rows = await searchFn(uid, q, limitParam);
					for (const row of Array.isArray(rows) ? rows : []) {
						const tag = row?.tag != null ? String(row.tag).trim() : "";
						if (!tag) continue;
						const tl = tag.toLowerCase();
						if (used.has(tl)) continue;
						used.add(tl);
						const title = row?.title != null ? String(row.title).trim() : "";
						const label = title || tag;
						items.push({
							type: "style",
							id: row?.id != null ? String(row.id) : `tag:${tag}`,
							tag,
							label,
							sublabel: `$${tag}`,
							insert_text: `$${tag} `,
							icon_shape: "square"
						});
						if (items.length >= limitParam) break;
					}
				}

				// Fill with legacy CREATE_STYLES keys (deduped by tag).
				const need = limitParam - items.length;
				if (need > 0) {
					items.push(...legacyStyleSuggestItems(q, need, used));
				}

				res.set("Cache-Control", "private, max-age=120");
				return res.json({ items });
			}

			// Unknown source: return empty so contract is stable
			res.set("Cache-Control", "private, max-age=60");
			return res.json({ items: [] });
		} catch (err) {
			console.error("[suggest]", err);
			return res.status(500).json({ error: "Suggest failed" });
		}
	});

	return router;
}
