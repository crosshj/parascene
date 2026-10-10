import { verifyShareToken } from "../../routes/utils/shareLink.js";

function decodeShareTokenPart(raw) {
	try {
		return decodeURIComponent(String(raw || ""));
	} catch {
		return String(raw || "");
	}
}

export function postedTextReferencesCreation(text, creationId) {
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) return false;
	const raw = String(text || "");
	if (!raw) return false;
	if (new RegExp(`/creations/${id}(?:\\D|$)`, "i").test(raw)) return true;
	if (new RegExp(`/(?:api/)?create/images/${id}(?:\\D|$)`, "i").test(raw)) return true;
	const shareRe = /\/s\/(v\d+)\/([^/\s"'<>]+)(?:\/|$)/gi;
	let match;
	while ((match = shareRe.exec(raw))) {
		const verified = verifyShareToken({ version: match[1], token: decodeShareTokenPart(match[2]) });
		if (verified.ok && Number(verified.imageId) === id) return true;
	}
	return false;
}

export function commentAllowsUnpublishedCreation({ image, comment, parent, viewerId }) {
	if (!image || !comment) return false;
	if (image.unavailable_at != null && image.unavailable_at !== "") return false;
	const viewer = Number(viewerId);
	if (!Number.isInteger(viewer) || viewer <= 0) return false;
	const onThisCreation = Number(comment.created_image_id) === Number(image.id);
	const pastedHere = postedTextReferencesCreation(comment.text, image.id);
	if (onThisCreation) return true;
	if (!pastedHere || !parent) return false;
	if (Number(parent.user_id) === viewer) return true;
	return parent.published === true || parent.published === 1;
}
