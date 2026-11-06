import { plainTextReplyPreview } from "../../src/shared/plainTextReplyPreview.js";
import { sanitizeClientReplyPreview } from "./chatReplyStamp.js";

/**
 * @typedef {{ user_id?: unknown, text?: unknown }} ParentCommentRowLike
 * @param {*} queries
 * @param {ParentCommentRowLike} parentRow
 * @param {*} clientPreviewRaw
 */
export async function composeCommentStampedReply(queries, referencedId, parentRow, clientPreviewRaw = "") {
	const uid = Number(parentRow?.user_id);
	let sender_user_name = null;
	let sender_avatar_url = null;
	let sender_plan = "free";
	if (Number.isFinite(uid) && uid > 0 && queries.selectUserProfilesByUserIds) {
		const pmap = await queries.selectUserProfilesByUserIds([uid]);
		const p = pmap?.get(uid);
		if (p) {
			sender_user_name = p.user_name != null ? String(p.user_name) : null;
			sender_avatar_url = p.avatar_url != null ? String(p.avatar_url) : null;
		}
	}
	if (Number.isFinite(uid) && uid > 0 && queries.selectUserById?.get) {
		try {
			const u = await queries.selectUserById.get(uid);
			sender_plan = u?.meta?.plan === "founder" ? "founder" : "free";
		} catch {
			sender_plan = "free";
		}
	}
	const bodyTxt = typeof parentRow?.text === "string" ? parentRow.text : "";
	const preview_from_body = bodyTxt.trim() ? plainTextReplyPreview(bodyTxt) : "";
	const clientSan = sanitizeClientReplyPreview(clientPreviewRaw);
	const preview_text = preview_from_body.trim()
		? preview_from_body
		: clientSan || "";

	return {
		referenced_id: Number(referencedId),
		sender_id: Number.isFinite(uid) ? uid : undefined,
		sender_user_name,
		sender_avatar_url,
		sender_plan,
		preview_text: preview_text || ""
	};
}
