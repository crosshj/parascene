import { verifyShareToken } from "./shareLink.js";
import { isChatThreadMember } from "./challengeSubmitShared.js";

export const POSTED_CREATION_PROOF_QUERY_KEYS = Object.freeze([
	"share_version",
	"share_token",
	"chat_message_id",
	"comment_id",
]);

export function parsePositiveInt(raw) {
	const n = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

export function postedTextReferencesCreation(text, creationId) {
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) return false;
	const raw = String(text || "");
	if (!raw) return false;
	if (new RegExp(`/creations/${id}(?:\\D|$)`, "i").test(raw)) return true;
	if (new RegExp(`/(?:api/)?create/images/${id}(?:\\D|$)`, "i").test(raw)) return true;
	const shareRe = /\/s\/(v\d+)\/([^/\s"'<>]+)(?:\/|$)/gi;
	let m;
	while ((m = shareRe.exec(raw))) {
		const verified = verifyShareToken({ version: m[1], token: decodeShareTokenPart(m[2]) });
		if (verified.ok && Number(verified.imageId) === id) return true;
	}
	return false;
}

function decodeShareTokenPart(raw) {
	try {
		return decodeURIComponent(String(raw || ""));
	} catch {
		return String(raw || "");
	}
}

export function readPostedCreationProofFromRequest(req) {
	const q = req?.query && typeof req.query === "object" ? req.query : {};
	const headers = req?.headers && typeof req.headers === "object" ? req.headers : {};
	const shareVersion = String(q.share_version || headers["x-share-version"] || "").trim();
	const shareToken = String(q.share_token || headers["x-share-token"] || "").trim();
	return {
		shareVersion,
		shareToken,
		chatMessageId: parsePositiveInt(q.chat_message_id),
		commentId: parsePositiveInt(q.comment_id),
	};
}

/**
 * Unpublished creation is viewable when the viewer can see a chat message or
 * comment that already published this creation into that conversation.
 */
export async function canViewUnpublishedCreationViaPostedRef({
	queries,
	sb,
	image,
	userId,
	shareVersion,
	shareToken,
	chatMessageId,
	commentId,
}) {
	if (!image) return { ok: false };
	if (image.unavailable_at != null && String(image.unavailable_at) !== "") return { ok: false };
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) return { ok: false };

	if (shareVersion && shareToken) {
		const verified = verifyShareToken({ version: shareVersion, token: shareToken });
		if (verified.ok && Number(verified.imageId) === Number(image.id)) {
			const status = image.status || "completed";
			if (status === "completed") {
				return { ok: true, via: "share", shareAccess: { version: shareVersion, token: shareToken } };
			}
		}
	}

	if (chatMessageId && sb) {
		const chatOk = await canViewUnpublishedCreationViaChatMessage(sb, {
			image,
			chatMessageId,
			viewerUserId: uid,
		});
		if (chatOk) return { ok: true, via: "chat_message", chatMessageId };
	}

	if (commentId && queries) {
		const commentOk = await canViewUnpublishedCreationViaComment(queries, {
			image,
			commentId,
			viewerUserId: uid,
		});
		if (commentOk) return { ok: true, via: "comment", commentId };
	}

	return { ok: false };
}

async function canViewUnpublishedCreationViaChatMessage(sb, { image, chatMessageId, viewerUserId }) {
	const { data: row, error } = await sb
		.from("prsn_chat_messages")
		.select("id, thread_id, body")
		.eq("id", chatMessageId)
		.maybeSingle();
	if (error) throw error;
	if (!row) return false;
	if (!postedTextReferencesCreation(row.body, image.id)) return false;
	const tid = Number(row.thread_id);
	if (!Number.isFinite(tid) || tid <= 0) return false;
	return isChatThreadMember(sb, tid, viewerUserId);
}

async function canViewUnpublishedCreationViaComment(queries, { image, commentId, viewerUserId }) {
	const comment = await queries.selectCommentById?.get(commentId);
	if (!comment) return false;
	const onThisCreation = Number(comment.created_image_id) === Number(image.id);
	const pastedHere = postedTextReferencesCreation(comment.text, image.id);
	if (onThisCreation) return true;
	if (!pastedHere) return false;
	const parentId = Number(comment.created_image_id);
	if (!Number.isFinite(parentId) || parentId <= 0) return false;
	const parent = await queries.selectCreatedImageByIdAnyUser?.get(parentId);
	if (!parent) return false;
	if (Number(parent.user_id) === Number(viewerUserId)) return true;
	return parent.published === 1 || parent.published === true;
}
