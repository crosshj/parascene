import { extractUniqueChatMentionUsernames } from "./chatAtMentions.js";
import { pathnameChatOpenForViewer } from "./chatDeepLinks.js";

/**
 * After a chat message is stored, notify @mentioned thread members (in-app notification → digest email path).
 * @param {{
 *   queries: { insertNotification?: { run: (...args: unknown[]) => Promise<unknown> }, selectUserProfileByUsername?: { get: (u: string) => Promise<object | undefined> } },
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
	if (!queries?.insertNotification?.run || !queries?.selectUserProfileByUsername?.get) return;

	const handles = extractUniqueChatMentionUsernames(body);
	if (handles.length === 0) return;

	const memberSet = new Set(
		(Array.isArray(memberUserIds) ? memberUserIds : [])
			.map((id) => Number(id))
			.filter((id) => Number.isFinite(id) && id > 0)
	);

	const target = { thread_id: threadId };
	const ttype = typeof threadType === "string" ? threadType.trim() : "";
	const slug = typeof channelSlug === "string" && channelSlug.trim() ? channelSlug.trim() : null;
	const dmKey = typeof dmPairKey === "string" && dmPairKey.trim() ? dmPairKey.trim() : null;
	const meta = {
		thread_type: ttype || null,
		channel_slug: slug,
		...(ttype === "dm" && dmKey ? { dm_pair_key: dmKey } : {})
	};

	for (const handle of handles) {
		let profile;
		try {
			profile = await queries.selectUserProfileByUsername.get(handle);
		} catch {
			continue;
		}
		const toUserId = profile?.user_id != null ? Number(profile.user_id) : null;
		if (!Number.isFinite(toUserId) || toUserId <= 0 || toUserId === senderId) continue;
		if (!memberSet.has(toUserId)) continue;

		const link = pathnameChatOpenForViewer({
			threadId,
			threadType: ttype || null,
			channelSlug: slug,
			dmPairKey: ttype === "dm" ? dmKey : null,
			viewerUserId: toUserId,
			otherUserProfile: null
		});

		const title = "Chat mention";
		const message = "Someone mentioned you in chat.";
		try {
			await queries.insertNotification.run(
				toUserId,
				null,
				title,
				message,
				link,
				senderId,
				"chat_mention",
				target,
				meta
			);
		} catch (err) {
			if (process.env.NODE_ENV !== "production") {
				console.error("[chat mention notification]", err?.message ?? err);
			}
		}
	}
}
