/**
 * Inbox / header label for a DM thread: @handle when available, else a numeric fallback.
 * @param {{ user_name?: string | null } | null | undefined} profile
 * @param {number | null | undefined} otherUserId
 * @returns {string}
 */
export function dmChatInboxTitleFromProfile(profile, otherUserId) {
	const un = typeof profile?.user_name === 'string' ? profile.user_name.trim() : '';
	if (un) return `@${un}`;
	const oid = Number(otherUserId);
	if (Number.isFinite(oid) && oid > 0) return `User ${oid}`;
	return 'DM';
}
