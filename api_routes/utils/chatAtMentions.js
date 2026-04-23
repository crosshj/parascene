/**
 * Extract @username tokens from chat message body for mention notifications.
 * Usernames are normalized to lowercase for profile lookup (aligned with DM path rules).
 * @param {string} text
 * @returns {string[]} deduped normalized handles without @
 */
export function extractUniqueChatMentionUsernames(text) {
	const raw = typeof text === "string" ? text : "";
	const out = [];
	const seen = new Set();
	const re = /@([a-zA-Z0-9_]+)/g;
	let match;
	while ((match = re.exec(raw)) !== null) {
		const token = (match[1] || "").trim();
		if (!token) continue;
		const normalized = token.toLowerCase();
		if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) continue;
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
	}
	return out;
}
