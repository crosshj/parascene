import { otherUserIdFromDmPairKey } from "./dmChatInboxTitle.js";

/**
 * Path-only deep link for opening a chat thread the same way the standalone chat UI does:
 * - channel → `/chat/c/:slug`
 * - dm → `/chat/dm/:username` or `/chat/dm/:numericId`
 * - fallback → `/chat/t/:threadId`
 * @param {{
 *   threadId: number | null | undefined,
 *   threadType?: string | null,
 *   channelSlug?: string | null,
 *   dmPairKey?: string | null,
 *   viewerUserId: number | null | undefined,
 *   otherUserProfile?: { user_name?: string | null } | null
 * }} args
 * @returns {string}
 */
export function pathnameChatOpenForViewer({
	threadId,
	threadType,
	channelSlug,
	dmPairKey,
	viewerUserId,
	otherUserProfile
}) {
	const tid = threadId != null && Number.isFinite(Number(threadId)) ? Number(threadId) : null;
	const ttype = typeof threadType === "string" ? threadType.trim() : "";
	if (ttype === "channel") {
		const slug = typeof channelSlug === "string" ? channelSlug.trim() : "";
		if (slug) {
			return `/chat/c/${encodeURIComponent(slug)}`;
		}
	}
	if (ttype === "dm") {
		const vid = viewerUserId != null && Number.isFinite(Number(viewerUserId)) ? Number(viewerUserId) : null;
		const oid = vid != null ? otherUserIdFromDmPairKey(dmPairKey, vid) : null;
		if (oid != null && Number.isFinite(oid) && oid > 0) {
			const un = typeof otherUserProfile?.user_name === "string" ? otherUserProfile.user_name.trim().toLowerCase() : "";
			if (un && /^[a-z0-9][a-z0-9_]{2,23}$/.test(un)) {
				return `/chat/dm/${encodeURIComponent(un)}`;
			}
			return `/chat/dm/${encodeURIComponent(String(oid))}`;
		}
	}
	if (tid != null && tid > 0) {
		return `/chat/t/${encodeURIComponent(String(tid))}`;
	}
	return "/connect#chat";
}
