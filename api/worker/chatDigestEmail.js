import { getBaseAppUrlForEmail } from "../../api_routes/utils/url.js";
import { pathnameChatOpenForViewer } from "../../api_routes/utils/chatDeepLinks.js";
import { dmChatInboxTitleFromProfile, otherUserIdFromDmPairKey } from "../../api_routes/utils/dmChatInboxTitle.js";

/**
 * Build chat thread lines for the activity digest email (unread from others, recent window).
 * @param {{ queries: { selectDigestChatUnreadThreadsSince?: { all: (userId: number, sinceIso: string, limit: number) => Promise<object[]> }, selectUserProfilesByUserIds?: (ids: number[]) => Promise<Map<number, object>> } }} args
 * @returns {Promise<{ chatThreadItems: { title: string; unread_count: number; thread_url: string }[] }>}
 */
export async function buildChatDigestEmailSection({ queries, userId, sinceIso, maxThreads = 8 }) {
	if (!queries?.selectDigestChatUnreadThreadsSince?.all) {
		return { chatThreadItems: [] };
	}
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) return { chatThreadItems: [] };

	const cap = Math.min(Math.max(1, Number(maxThreads) || 8), 24);
	let rows;
	try {
		rows = await queries.selectDigestChatUnreadThreadsSince.all(uid, sinceIso, cap);
	} catch {
		return { chatThreadItems: [] };
	}
	const list = Array.isArray(rows) ? rows : [];

	const otherIds = new Set();
	for (const row of list) {
		if (String(row?.thread_type || "").trim() !== "dm") continue;
		const oid = otherUserIdFromDmPairKey(row?.dm_pair_key, uid);
		if (oid != null && Number.isFinite(oid) && oid > 0) otherIds.add(oid);
	}

	/** @type {Map<number, object>} */
	let profileMap = new Map();
	if (otherIds.size > 0 && typeof queries.selectUserProfilesByUserIds === "function") {
		try {
			profileMap = await queries.selectUserProfilesByUserIds([...otherIds]);
		} catch {
			profileMap = new Map();
		}
	}

	const base = getBaseAppUrlForEmail().replace(/\/+$/, "");
	const chatThreadItems = list.map((row) => {
		const threadId = Number(row?.thread_id);
		const unc = Number(row?.unread_count ?? 0);
		const ttype = String(row?.thread_type || "").trim();
		const oid = ttype === "dm" ? otherUserIdFromDmPairKey(row?.dm_pair_key, uid) : null;
		const otherProf = oid != null ? profileMap.get(oid) : null;
		const path = pathnameChatOpenForViewer({
			threadId: Number.isFinite(threadId) && threadId > 0 ? threadId : null,
			threadType: row?.thread_type,
			channelSlug: row?.channel_slug,
			dmPairKey: row?.dm_pair_key,
			viewerUserId: uid,
			otherUserProfile: otherProf ?? null
		});
		const threadUrl = path.startsWith("/") ? `${base}${path}` : `${base}/connect#chat`;
		if (ttype === "channel") {
			const slug = typeof row?.channel_slug === "string" && row.channel_slug.trim() ? row.channel_slug.trim() : "channel";
			return {
				title: `#${slug}`,
				unread_count: Number.isFinite(unc) && unc > 0 ? unc : 0,
				thread_url: threadUrl
			};
		}
		if (ttype === "dm") {
			const dmTitle = dmChatInboxTitleFromProfile(otherProf ?? null, oid);
			return {
				title: `DM · ${dmTitle}`,
				unread_count: Number.isFinite(unc) && unc > 0 ? unc : 0,
				thread_url: threadUrl
			};
		}
		return {
			title: "Chat",
			unread_count: Number.isFinite(unc) && unc > 0 ? unc : 0,
			thread_url: threadUrl
		};
	});

	return { chatThreadItems };
}
