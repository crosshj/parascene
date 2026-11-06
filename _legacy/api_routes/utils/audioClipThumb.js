import sharp from "sharp";
import {
	buildGenericAudioUrl,
	parseClipMeta,
	parseGenericStorageKeyFromUrl,
	parseCreationIdFromLink,
	isFounderOrAdmin
} from "./audioClips.js";
import {
	mapCreatedImageRowMediaFields,
	resolveCreationMediaType
} from "./resolveCreationDisplayMedia.js";

export { parseCreationIdFromLink };

export async function deleteStoredClipThumb(storage, thumbUrl) {
	const key = parseGenericStorageKeyFromUrl(thumbUrl);
	if (!key || typeof storage?.deleteGenericImage !== "function") return;
	try {
		await storage.deleteGenericImage(key);
	} catch {
		// ignore
	}
}

async function resizeAndStoreClipThumb(buffer, storage, userId, clipId) {
	const resized = await sharp(buffer)
		.rotate()
		.resize(280, 320, { fit: "cover" })
		.png()
		.toBuffer();
	const rand = Math.random().toString(36).slice(2, 9);
	const key = `prompt-audio/thumbs/${userId}_${clipId}_${Date.now()}_${rand}.png`;
	await storage.uploadGenericImage(resized, key, { contentType: "image/png" });
	return buildGenericAudioUrl(key);
}

/**
 * @returns {{ ok: true, thumb_url: string, thumb_creation_id: number } | { ok: false, status: number, error: string, message?: string }}
 */
export async function buildClipThumbFromCreation({ creation, storage, userId, clipId }) {
	if (!creation || typeof storage?.getImageBuffer !== "function" || typeof storage?.uploadGenericImage !== "function") {
		return { ok: false, status: 501, error: "Clip images are not available" };
	}
	const filename = creation.filename != null ? String(creation.filename).trim() : "";
	if (!filename || filename.includes("..") || filename.includes("/")) {
		return { ok: false, status: 400, error: "Invalid creation image" };
	}
	const meta = parseClipMeta(creation.meta);
	const mediaType = resolveCreationMediaType(meta, creation.media_type);
	const isVideo = mediaType === "video";
	let buffer;
	try {
		buffer = await storage.getImageBuffer(filename, isVideo ? { variant: "thumbnail" } : undefined);
	} catch {
		return { ok: false, status: 400, error: "Could not read creation image" };
	}
	let thumbUrl;
	try {
		thumbUrl = await resizeAndStoreClipThumb(buffer, storage, userId, clipId);
	} catch {
		return { ok: false, status: 400, error: "Could not process creation image" };
	}
	const creationId = Number(creation.id);
	return {
		ok: true,
		thumb_url: thumbUrl,
		thumb_creation_id: Number.isFinite(creationId) && creationId > 0 ? creationId : null
	};
}

/**
 * @returns {{ ok: true, thumb_url: string } | { ok: false, status: number, error: string }}
 */
export async function buildClipThumbFromUploadBuffer({ buffer, storage, userId, clipId }) {
	if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
		return { ok: false, status: 400, error: "Empty image upload" };
	}
	if (buffer.length > 10 * 1024 * 1024) {
		return { ok: false, status: 413, error: "Image file too large" };
	}
	if (typeof storage?.uploadGenericImage !== "function") {
		return { ok: false, status: 501, error: "Clip images are not available" };
	}
	try {
		const thumbUrl = await resizeAndStoreClipThumb(buffer, storage, userId, clipId);
		return { ok: true, thumb_url: thumbUrl };
	} catch {
		return { ok: false, status: 400, error: "Could not process image" };
	}
}

/**
 * Validate a creation row for use as clip thumb source.
 * Published creations are allowed for anyone setting a clip image. Unpublished
 * creations are allowed when the editor owns the creation (image is copied to
 * generic storage so the clip thumbnail is viewable without the source draft).
 * @returns {{ ok: true, creation: object } | { ok: false, status: number, error: string, message?: string }}
 */
export function validateCreationForClipThumb(creation, { userId = null, user = null } = {}) {
	if (!creation) {
		return { ok: false, status: 404, error: "Creation not found" };
	}
	const published = creation.published === 1 || creation.published === true;
	const uid = Number(userId);
	const isOwner = Number.isFinite(uid) && uid > 0 && Number(creation.user_id) === uid;
	if (!published && !isOwner && !isFounderOrAdmin(user)) {
		return {
			ok: false,
			status: 400,
			error: "Invalid creation",
			message:
				"Use a published creation or one of your own drafts. The image is copied so others can see the clip thumbnail."
		};
	}
	if (creation.unavailable_at != null && String(creation.unavailable_at).trim() !== "") {
		return {
			ok: false,
			status: 400,
			error: "Invalid creation",
			message: "This creation is unavailable."
		};
	}
	const status = creation.status != null ? String(creation.status).trim().toLowerCase() : "";
	if (status && status !== "completed") {
		return { ok: false, status: 400, error: "Creation is not ready to use as an image." };
	}
	const filename = creation.filename != null ? String(creation.filename).trim() : "";
	if (!filename || filename.includes("..") || filename.includes("/")) {
		return { ok: false, status: 400, error: "Invalid creation image" };
	}
	return { ok: true, creation };
}

/**
 * Apply thumb changes to clip meta (clear and/or from creation link).
 * @returns {{ ok: true, meta: object } | { ok: false, status: number, error: string, message?: string }}
 */
export async function resolveClipThumbMetaPatch({
	clip,
	body,
	queries,
	storage,
	userId,
	user = null
}) {
	const existing = parseClipMeta(clip.meta);
	const clearThumb = body.clear_thumb === true;
	const linkRaw = typeof body.creation_link === "string" ? body.creation_link.trim() : "";
	if (!clearThumb && !linkRaw) return { ok: true, meta: null };

	const oldThumbUrl = typeof existing.thumb_url === "string" ? existing.thumb_url.trim() : "";
	let nextMeta = { ...existing };

	if (clearThumb && !linkRaw) {
		await deleteStoredClipThumb(storage, oldThumbUrl);
		nextMeta.thumb_url = null;
		nextMeta.thumb_creation_id = null;
		return { ok: true, meta: nextMeta };
	}

	if (!linkRaw) {
		return { ok: true, meta: null };
	}

	const creationId = parseCreationIdFromLink(linkRaw);
	if (!creationId) {
		return {
			ok: false,
			status: 400,
			error: "Invalid link",
			message: "Paste a creation URL such as /creations/123 or a numeric id."
		};
	}
	const getCreation =
		queries.selectCreatedImageByIdAnyUser?.get ?? queries.selectCreatedImageById?.get ?? null;
	if (typeof getCreation !== "function") {
		return { ok: false, status: 501, error: "Not available" };
	}
	const creation = await getCreation(creationId);
	const validated = validateCreationForClipThumb(creation, { userId, user });
	if (!validated.ok) return validated;

	const built = await buildClipThumbFromCreation({
		creation: validated.creation,
		storage,
		userId,
		clipId: clip.id
	});
	if (!built.ok) return built;

	if (oldThumbUrl && oldThumbUrl !== built.thumb_url) {
		await deleteStoredClipThumb(storage, oldThumbUrl);
	}
	nextMeta.thumb_url = built.thumb_url;
	nextMeta.thumb_creation_id = built.thumb_creation_id;
	return { ok: true, meta: nextMeta };
}
