import { getNotificationDisplayName } from "./displayName.js";
import { pathnameChatOpenForViewer } from "./chatDeepLinks.js";
import { otherUserIdFromDmPairKey } from "./dmChatInboxTitle.js";

function parseJson(value) {
	if (value == null) return null;
	if (typeof value === "object") return value;
	if (typeof value !== "string") return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

/**
 * Resolve title, message, and link for a notification that has type/actor/target/meta.
 * Uses current DB state (actor display name, creation title) so copy can change over time.
 * @param {{ type?: string | null, actor_user_id?: number | null, user_id?: number | null, target?: string | object | null, meta?: string | object | null }} row
 * @param {{ selectUserById?: { get: (id: number) => Promise<object> }, selectUserProfileByUserId?: { get: (id: number) => Promise<object> }, selectCreatedImageByIdAnyUser?: { get: (id: number) => Promise<object> } }} queries
 * @returns {{ title: string, message: string, link: string, creation_title?: string | null } | null} resolved payload or null to use stored title/message/link
 */
export async function resolveNotificationDisplay(row, queries) {
	const type = typeof row?.type === "string" ? row.type.trim() : null;
	const actorUserId = row?.actor_user_id != null && Number.isFinite(Number(row.actor_user_id)) ? Number(row.actor_user_id) : null;
	if (!type || !actorUserId) return null;

	const target = parseJson(row?.target);
	const meta = parseJson(row?.meta);

	let actorUser = null;
	let actorProfile = null;
	try {
		actorUser = await queries.selectUserById?.get(actorUserId) ?? null;
		actorProfile = await queries.selectUserProfileByUserId?.get(actorUserId) ?? null;
	} catch {
		return null;
	}
	const actorName = getNotificationDisplayName(actorUser, actorProfile);

	const creationId = target?.creation_id != null && Number.isFinite(Number(target.creation_id)) ? Number(target.creation_id) : null;
	let creationTitle = typeof meta?.creation_title === "string" ? meta.creation_title.trim() : null;
	if (creationId != null && !creationTitle && queries.selectCreatedImageByIdAnyUser?.get) {
		try {
			const creation = await queries.selectCreatedImageByIdAnyUser.get(creationId);
			creationTitle = typeof creation?.title === "string" ? creation.title.trim() : null;
		} catch {
			// keep creationTitle as is
		}
	}

	const baseLink = creationId != null ? `/creations/${encodeURIComponent(String(creationId))}` : "/";

	switch (type) {
		case "comment": {
			const title = creationTitle
				? `Comment on "${creationTitle}"`
				: "Comment on your creation";
			const message = `${actorName} commented`;
			return { title, message, link: baseLink, creation_title: creationTitle || null };
		}
		case "comment_thread": {
			const title = creationTitle
				? `Comment on "${creationTitle}"`
				: "Comment on a creation you commented on";
			const message = `${actorName} commented`;
			return { title, message, link: baseLink, creation_title: creationTitle || null };
		}
		case "chat_mention": {
			const threadId =
				target?.thread_id != null && Number.isFinite(Number(target.thread_id)) ? Number(target.thread_id) : null;
			if (threadId == null) return null;
			const slug = typeof meta?.channel_slug === "string" && meta.channel_slug.trim() ? meta.channel_slug.trim() : null;
			const ttype = typeof meta?.thread_type === "string" ? meta.thread_type.trim() : "";
			const place =
				ttype === "channel" && slug
					? `#${slug}`
					: ttype === "dm"
						? "a direct message"
						: "chat";
			const title = `Mentioned you in ${place}`;
			const message = `${actorName} mentioned you`;
			const viewerId = row?.user_id != null && Number.isFinite(Number(row.user_id)) ? Number(row.user_id) : null;
			let otherUserProfile = null;
			if (ttype === "dm" && viewerId != null && queries.selectUserProfileByUserId?.get) {
				const oid = otherUserIdFromDmPairKey(meta?.dm_pair_key, viewerId);
				if (oid != null && Number.isFinite(oid) && oid > 0) {
					try {
						otherUserProfile = await queries.selectUserProfileByUserId.get(oid) ?? null;
					} catch {
						otherUserProfile = null;
					}
				}
			}
			const link = pathnameChatOpenForViewer({
				threadId,
				threadType: ttype || null,
				channelSlug: slug,
				dmPairKey: typeof meta?.dm_pair_key === "string" ? meta.dm_pair_key : null,
				viewerUserId: viewerId,
				otherUserProfile
			});
			return { title, message, link, creation_title: null };
		}
		case "tip": {
			const amount = meta?.amount != null && Number.isFinite(Number(meta.amount)) ? Number(meta.amount) : null;
			const amountStr = amount != null ? `${amount.toFixed(1)}` : "some";
			const tipNote =
				typeof meta?.tip_note === "string" && meta.tip_note.trim() ? meta.tip_note.trim() : "";
			const isAdmin = actorUser?.role === "admin";
			const teamAckTip = isAdmin && creationId == null;
			const title = teamAckTip ? "You received a tip from the team" : "You received a tip";
			let message = teamAckTip
				? `You received ${amountStr} credits.`
				: `${actorName} tipped you ${amountStr} credits.`;
			if (tipNote) {
				message = `${message}\n\n${tipNote}`;
			}
			return { title, message, link: baseLink, creation_title: creationTitle || null };
		}
		default:
			return null;
	}
}
