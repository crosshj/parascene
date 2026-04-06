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

/** Persona tag prefix: same charset as personality slugs (hyphen allowed). */
function normalizePersonaSuggestPrefix(raw) {
	const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (!s) return "";
	return s.replace(/[^a-z0-9_-]/g, "") || "";
}

function parsePromptInjectionMeta(raw) {
	if (raw == null) return {};
	if (typeof raw === "object" && !Array.isArray(raw)) return raw;
	if (typeof raw !== "string" || !raw.trim()) return {};
	try {
		const o = JSON.parse(raw);
		return o && typeof o === "object" && !Array.isArray(o) ? o : {};
	} catch {
		return {};
	}
}

/** Interleave user + persona hits so neither group fills the whole list when both have matches. */
function balancedMergeMentionItems(userItems, personaItems, limit) {
	const cap = Math.min(Math.max(1, Number(limit) || 10), 20);
	const out = [];
	let i = 0;
	let j = 0;
	let preferUser = true;
	while (out.length < cap && (i < userItems.length || j < personaItems.length)) {
		if (preferUser) {
			if (i < userItems.length) out.push(userItems[i++]);
			else if (j < personaItems.length) out.push(personaItems[j++]);
		} else {
			if (j < personaItems.length) out.push(personaItems[j++]);
			else if (i < userItems.length) out.push(userItems[i++]);
		}
		preferUser = !preferUser;
	}
	return out;
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
 * GET /api/suggest?source=users|mentions|styles&q=...&limit=10
 * Generic suggest endpoint for triggered autocomplete (mentions, tags, styles, etc.).
 * - users: consumer profiles only (e.g. DM picker).
 * - mentions: users + prompt-library personas, balanced interleave, each item has type user|persona.
 * - styles: style injections + legacy keys.
 * Auth required. Returns { items: [{ type, id, label, sublabel?, icon_url?, badge?, insert_text? }] }.
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

			if (source === "mentions") {
				const qUser = normalizeSuggestQuery(rawQ);
				const qPersona = normalizePersonaSuggestPrefix(rawQ);
				if (!qUser && !qPersona) {
					res.set("Cache-Control", "private, max-age=60");
					return res.json({ items: [] });
				}
				const uid = Number(req.auth.userId);
				const userSearch =
					qUser && typeof queries.searchUserProfilesByPrefix === "function"
						? queries.searchUserProfilesByPrefix(qUser, limitParam)
						: Promise.resolve([]);
				const personaSearchFn = queries.searchPersonaPromptInjectionsByPrefix?.all;
				const personaSearch =
					qPersona && typeof personaSearchFn === "function"
						? personaSearchFn(uid, qPersona, limitParam)
						: Promise.resolve([]);
				const [userRows, personaRows] = await Promise.all([userSearch, personaSearch]);
				const userItems = (Array.isArray(userRows) ? userRows : []).map((row) => {
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
				const personaItems = (Array.isArray(personaRows) ? personaRows : []).map((row) => {
					const tag = row?.tag != null ? String(row.tag).trim().toLowerCase() : "";
					const title = row?.title != null ? String(row.title).trim() : "";
					const label = title || tag || "Persona";
					const meta = parsePromptInjectionMeta(row.meta);
					const avatarRaw = meta?.persona_avatar_url;
					const icon_url =
						typeof avatarRaw === "string" && avatarRaw.trim() ? avatarRaw.trim() : undefined;
					return {
						type: "persona",
						id: tag ? `persona:${tag}` : "",
						tag,
						label,
						sublabel: tag ? `@${tag}` : undefined,
						icon_url,
						insert_text: tag ? `@${tag} ` : undefined
					};
				});
				const items = balancedMergeMentionItems(userItems, personaItems, limitParam);
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
						const meta = parsePromptInjectionMeta(row.meta);
						const thumb =
							typeof meta.style_thumb_url === "string" ? meta.style_thumb_url.trim() : "";
						const entry = {
							type: "style",
							id: row?.id != null ? String(row.id) : `tag:${tag}`,
							tag,
							label,
							sublabel: `$${tag}`,
							insert_text: `$${tag} `,
							icon_shape: "square"
						};
						if (thumb) {
							entry.icon_url = thumb;
						}
						items.push(entry);
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
