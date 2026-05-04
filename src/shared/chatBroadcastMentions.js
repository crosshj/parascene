/**
 * Reserved @-tokens in chat: highlighted in the UI but not profile links.
 * Used for future “notify everyone in thread / channel” style behavior.
 * Keep server mention extraction in sync (see api_routes/utils/chatAtMentions.js).
 */
export const CHAT_BROADCAST_MENTION_SLUGS = new Set([
	'here',
	'channel',
	'everyone',
	'all',
]);

/**
 * @param {string} slug — token without @
 * @returns {boolean}
 */
export function isChatBroadcastMentionSlug(slug) {
	return CHAT_BROADCAST_MENTION_SLUGS.has(String(slug || '').trim().toLowerCase());
}
