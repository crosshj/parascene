import { pathnameChatOpenForViewer } from "./chatDeepLinks.js";
import { extractUserMentionHandles } from "./textMentions.js";
import { insertActivityNotification } from "./activityNotifications.js";

/**
 * Chat in-app notifications for @username mentions in **channels only**.
 * DMs use chat roster + global badge only (no bell rows — chat owns that UX).
 * @here / @channel are highlighted in the message UI but do not create bell rows.
 *
 * @param {{
 *   queries: { insertNotification?: { run: (...args: unknown[]) => Promise<unknown> }, selectUserProfileByUsername?: { get: (u: string) => Promise<object | undefined> }, selectNotificationsForUser?: { all: (...args: unknown[]) => Promise<object[]> } },
 *   memberUserIds: number[],
 *   threadId: number,
 *   threadType: string | null | undefined,
 *   channelSlug: string | null | undefined,
 *   dmPairKey: string | null | undefined,
 *   senderId: number,
 *   body: string
 * }} args
 */
export async function insertNotificationsForChatMentions({
	queries,
	memberUserIds,
	threadId,
	threadType,
	channelSlug,
	dmPairKey,
	senderId,
	body
}) {
	if (!queries?.insertNotification?.run) return;

	const tid = Number(threadId);
	const sid = Number(senderId);
	if (!Number.isFinite(tid) || tid <= 0 || !Number.isFinite(sid) || sid <= 0) return;

	const memberSet = new Set(
		(Array.isArray(memberUserIds) ? memberUserIds : [])
			.map((id) => Number(id))
			.filter((id) => Number.isFinite(id) && id > 0)
	);

	const ttype = typeof threadType === "string" ? threadType.trim() : "";
	if (ttype === "dm") return;

	const slug = typeof channelSlug === "string" && channelSlug.trim() ? channelSlug.trim() : null;
	const dmKey = typeof dmPairKey === "string" && dmPairKey.trim() ? dmPairKey.trim() : null;
	const target = { thread_id: tid };
	const metaBase = {
		thread_type: ttype || null,
		channel_slug: slug,
		...(ttype === "dm" && dmKey ? { dm_pair_key: dmKey } : {})
	};

	const linkForViewer = (viewerUserId) =>
		pathnameChatOpenForViewer({
			threadId: tid,
			threadType: ttype || null,
			channelSlug: slug,
			dmPairKey: ttype === "dm" ? dmKey : null,
			viewerUserId,
			otherUserProfile: null
		});

	const handles = extractUserMentionHandles(body);
	for (const handle of handles) {
		let profile;
		try {
			profile = await queries.selectUserProfileByUsername.get(handle);
		} catch {
			continue;
		}
		const toUserId = profile?.user_id != null ? Number(profile.user_id) : null;
		if (!Number.isFinite(toUserId) || toUserId <= 0 || toUserId === sid) continue;
		if (!memberSet.has(toUserId)) continue;

		await insertActivityNotification({
			queries,
			toUserId,
			actorUserId: sid,
			type: "chat_mention",
			target,
			link: linkForViewer(toUserId),
			meta: metaBase
		});
	}
}
