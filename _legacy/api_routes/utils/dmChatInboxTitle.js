/**
 * Parse `dm_pair_key` ("smallerId:largerId") and return the other participant for `viewerUserId`.
 * @param {string | null | undefined} dmPairKey
 * @param {number | null | undefined} viewerUserId
 * @returns {number | null}
 */
export function otherUserIdFromDmPairKey(dmPairKey, viewerUserId) {
	if (!dmPairKey || typeof dmPairKey !== "string") return null;
	const parts = dmPairKey.split(":");
	if (parts.length !== 2) return null;
	const a = Number(parts[0]);
	const b = Number(parts[1]);
	const v = Number(viewerUserId);
	if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(v)) return null;
	if (a === v) return b;
	if (b === v) return a;
	return null;
}

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
