import { isChatBroadcastMentionSlug } from "../../public/shared/chatBroadcastMentions.js";

/**
 * Normalize @handle token for profile lookup (aligned with chat/DM rules).
 * @param {string} token — without @
 * @returns {string | null}
 */
export function normalizeMentionHandle(token) {
	const raw = typeof token === "string" ? token.trim() : "";
	if (!raw) return null;
	const normalized = raw.toLowerCase();
	if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) return null;
	return normalized;
}

/**
 * @param {string} text
 * @returns {string[]} deduped normalized handles (no broadcast slugs)
 */
export function extractUserMentionHandles(text) {
	const raw = typeof text === "string" ? text : "";
	const out = [];
	const seen = new Set();
	const re = /@([a-zA-Z0-9_]+)/g;
	let match;
	while ((match = re.exec(raw)) !== null) {
		const normalized = normalizeMentionHandle(match[1] || "");
		if (!normalized || isChatBroadcastMentionSlug(normalized)) continue;
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
	}
	return out;
}

/**
 * @param {string} text
 * @returns {string[]} broadcast slugs present (@here, @channel, …)
 */
export function extractBroadcastMentionSlugs(text) {
	const raw = typeof text === "string" ? text : "";
	const out = [];
	const seen = new Set();
	const re = /@([a-zA-Z0-9_]+)/g;
	let match;
	while ((match = re.exec(raw)) !== null) {
		const slug = (match[1] || "").trim().toLowerCase();
		if (!isChatBroadcastMentionSlug(slug) || seen.has(slug)) continue;
		seen.add(slug);
		out.push(slug);
	}
	return out;
}

/**
 * Collect text fields from a creation that may contain @mentions.
 * @param {{ title?: string | null, description?: string | null, meta?: object | string | null }} creation
 * @returns {string[]}
 */
export function collectCreationMentionSourceTexts(creation) {
	const parts = [];
	const title = typeof creation?.title === "string" ? creation.title.trim() : "";
	const description = typeof creation?.description === "string" ? creation.description.trim() : "";
	if (title) parts.push(title);
	if (description) parts.push(description);
	let meta = creation?.meta;
	if (typeof meta === "string") {
		try {
			meta = JSON.parse(meta);
		} catch {
			meta = null;
		}
	}
	if (meta && typeof meta === "object") {
		const prompt = typeof meta.args?.prompt === "string" ? meta.args.prompt.trim() : "";
		if (prompt) parts.push(prompt);
	}
	return parts;
}
