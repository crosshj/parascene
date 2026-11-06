import { plainTextReplyPreview } from "../../src/shared/plainTextReplyPreview.js";

const CLIENT_REPLY_PREVIEW_HARD_MAX = 400;

const CHAT_PRIVATE_BODY_PREFIX = "enc:v1:";

/** @param {unknown} raw */
export function sanitizeClientReplyPreview(raw, maxChars = CLIENT_REPLY_PREVIEW_HARD_MAX) {
	if (raw == null) return "";
	let s =
		typeof raw === "string"
			? raw.replace(/\u0000/g, "").replace(/\r\n/g, "\n").replace(/\n+/g, " ").trim()
			: "";
	const cap = Math.max(16, Math.min(CLIENT_REPLY_PREVIEW_HARD_MAX, Number(maxChars) || CLIENT_REPLY_PREVIEW_HARD_MAX));
	if (s.length > cap) {
		s = s.slice(0, cap).trimEnd();
	}
	return s.replace(/[<>]/g, "");
}

/**
 * Fetch chat sender display fields for stamping reply previews.
 */
export async function fetchChatSenderSnippet(sb, senderId) {
	const sid = Number(senderId);
	if (!Number.isFinite(sid) || sid <= 0) {
		return { sender_user_name: null, sender_avatar_url: null, sender_plan: "free" };
	}
	const [{ data: prof, error: pErr }, { data: urow, error: uErr }] = await Promise.all([
		sb.from("prsn_user_profiles").select("user_name, avatar_url").eq("user_id", sid).maybeSingle(),
		sb.from("prsn_users").select("id, meta").eq("id", sid).maybeSingle()
	]);
	if (pErr) throw pErr;
	if (uErr) throw uErr;
	const founder = urow?.meta && typeof urow.meta === "object" && urow.meta.plan === "founder";
	return {
		sender_user_name: prof?.user_name != null ? String(prof.user_name) : null,
		sender_avatar_url: prof?.avatar_url != null ? String(prof.avatar_url) : null,
		sender_plan: founder ? "founder" : "free"
	};
}

function parentBodyLikelyUnreadableEncrypted(bodyRaw) {
	return String(bodyRaw || "").startsWith(CHAT_PRIVATE_BODY_PREFIX);
}

/**
 * Build stamped `meta.reply` for new chat rows.
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {{
 *   id?: unknown,
 *   thread_id?: unknown,
 *   sender_id?: unknown,
 *   body?: unknown,
 * }} parentRow — parent message row from DB (body may still be ciphertext for private threads)
 * @param {*} clientPreviewSanitized — from `sanitizeClientReplyPreview`
 */
export async function composeChatStampedReply(sb, referencedId, parentRow, clientPreviewSanitized = "") {
	const sid = Number(parentRow?.sender_id);
	const snippets = Number.isFinite(sid) && sid > 0 ? await fetchChatSenderSnippet(sb, sid) : {
		sender_user_name: null,
		sender_avatar_url: null,
		sender_plan: "free"
	};
	const bodyPlain = parentBodyLikelyUnreadableEncrypted(parentRow?.body) ? "" : String(parentRow?.body ?? "");
	const preview_from_body = bodyPlain.trim() ? plainTextReplyPreview(bodyPlain) : "";
	const preview_from_client =
		typeof clientPreviewSanitized === "string" ? clientPreviewSanitized.trim().slice(0, CLIENT_REPLY_PREVIEW_HARD_MAX) : "";
	const preview_text = preview_from_body.trim() ? preview_from_body : preview_from_client;

	return {
		referenced_id: Number(referencedId),
		sender_id: Number.isFinite(Number(parentRow?.sender_id)) ? Number(parentRow.sender_id) : undefined,
		sender_user_name: snippets.sender_user_name,
		sender_avatar_url: snippets.sender_avatar_url,
		sender_plan: snippets.sender_plan,
		preview_text: preview_text || ""
	};
}
