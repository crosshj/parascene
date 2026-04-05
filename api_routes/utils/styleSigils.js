/**
 * $-style tokens in prompts: extract, resolve (DB + legacy CREATE_STYLES), expand for provider.
 */

import { getLegacyStyleModifiersForSlug } from "./createStyles.js";

/** Match $slug: slug starts with a letter (avoids $100, etc.). */
const STYLE_SIGIL_RE = /\$([a-zA-Z][a-zA-Z0-9_-]*)/g;

/**
 * @param {string} text
 * @returns {Array<{ raw: string, slug: string, key: string }>}
 */
export function extractStyleSigilTokens(text) {
	const s = typeof text === "string" ? text : "";
	const out = [];
	const seen = new Set();
	let m;
	const re = new RegExp(STYLE_SIGIL_RE.source, "g");
	while ((m = re.exec(s)) !== null) {
		const slug = (m[1] || "").trim();
		if (!slug) continue;
		const key = slug.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ raw: m[0], slug, key });
	}
	return out;
}

/**
 * Strip $slug tokens from prompt (single spaces collapsed where tokens were).
 * @param {string} text
 * @returns {string}
 */
export function stripStyleSigilsFromPrompt(text) {
	const s = typeof text === "string" ? text : "";
	return s
		.replace(/\$[a-zA-Z][a-zA-Z0-9_-]*/g, "")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * @param {object} queries
 * @param {number} userId
 * @param {string} slug
 * @returns {Promise<string | null>} injection_text or legacy modifiers
 */
async function resolveStyleModifiers(queries, userId, slug) {
	const raw = typeof slug === "string" ? slug.trim() : "";
	if (!raw) return null;

	const fn = queries.selectPromptInjectionStyleBySlugForUser?.get;
	if (typeof fn === "function") {
		const row = await fn(userId, raw);
		if (row && typeof row.injection_text === "string" && row.injection_text.trim()) {
			return row.injection_text.trim();
		}
	}

	return getLegacyStyleModifiersForSlug(raw);
}

/**
 * Expand $style tokens by stripping sigils from the prose, then appending a plain "style:" section
 * with resolved modifier text (DB injection_text or legacy CREATE_STYLES). Does not use # style / # prompt headers.
 * Mention hydration is unchanged and lives elsewhere.
 * @param {object} queries
 * @param {number} userId
 * @param {string} promptText
 * @returns {Promise<{ ok: true, providerPrompt: string, resolved: Array<{ slug: string }> } | { ok: false, failed_styles: Array<{ token: string, reason: string }> }>}
 */
export async function expandStyleSigilsForProvider(queries, userId, promptText) {
	const promptStr = typeof promptText === "string" ? promptText : "";
	const tokens = extractStyleSigilTokens(promptStr);
	if (tokens.length === 0) {
		return { ok: true, providerPrompt: promptStr, resolved: [] };
	}

	const failed_styles = [];
	const modifiersParts = [];
	const resolved = [];

	for (const t of tokens) {
		const mods = await resolveStyleModifiers(queries, userId, t.slug);
		if (!mods) {
			failed_styles.push({ token: `$${t.slug}`, reason: "style_not_found" });
			continue;
		}
		modifiersParts.push(mods);
		resolved.push({ slug: t.slug });
	}

	if (failed_styles.length > 0) {
		return { ok: false, failed_styles };
	}

	const stripped = stripStyleSigilsFromPrompt(promptStr);
	const styleBlock = modifiersParts.join("\n\n");
	if (!styleBlock) {
		return { ok: true, providerPrompt: stripped, resolved };
	}
	// e.g. "figure in a field\n\nstyle:\n<modifier text>"
	if (!stripped.trim()) {
		return {
			ok: true,
			providerPrompt: `style:\n${styleBlock}`,
			resolved
		};
	}
	return {
		ok: true,
		providerPrompt: `${stripped.trim()}\n\nstyle:\n${styleBlock}`,
		resolved
	};
}
