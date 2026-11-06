import { isChatBroadcastMentionSlug } from "../../public/shared/chatBroadcastMentions.js";

function escapeRegExp(value) {
	return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether text contains @slug as a mention token for persona discovery.
 * Requires @slug followed by whitespace, end of text, end of line, or sentence-ending . ! ?
 * — not @slugfoo or mid-sentence punctuation like commas.
 * @param {string} text
 * @param {string} normalizedSlug — lowercase slug without @
 */
export function textContainsBoundedPersonalityMention(text, normalizedSlug) {
	const raw = typeof text === "string" ? text : "";
	const slug = typeof normalizedSlug === "string" ? normalizedSlug.trim().toLowerCase() : "";
	if (!raw || !slug) return false;
	const re = new RegExp(
		`(^|[^a-zA-Z0-9_-])@${escapeRegExp(slug)}($|\\s|[.!?](?=$|\\s))`,
		"i"
	);
	return re.test(raw);
}

/**
 * Prompt fields on a creation meta blob that may contain @mentions.
 * @param {object | string | null | undefined} meta
 * @returns {string[]}
 */
export function collectCreationPromptMentionTexts(meta) {
	let parsed = meta;
	if (typeof parsed === "string") {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			parsed = null;
		}
	}
	if (!parsed || typeof parsed !== "object") return [];
	const texts = [];
	const userPrompt = typeof parsed.user_prompt === "string" ? parsed.user_prompt.trim() : "";
	const argsPrompt = typeof parsed.args?.prompt === "string" ? parsed.args.prompt.trim() : "";
	if (userPrompt) texts.push(userPrompt);
	if (argsPrompt) texts.push(argsPrompt);
	return texts;
}

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
