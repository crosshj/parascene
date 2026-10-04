import sharp from "sharp";

/** Square cap for stored profile avatars. Cover-crop; never upscale smaller sources. */
export const PROFILE_AVATAR_SIZE = 256;
export const PROFILE_AVATAR_CONTENT_TYPE = "image/webp";
export const PROFILE_AVATAR_WEBP_QUALITY = 82;

export function buildGenericImageUrl(key) {
	const segments = String(key || "")
		.split("/")
		.filter(Boolean)
		.map((seg) => encodeURIComponent(seg));
	return `/api/images/generic/${segments.join("/")}`;
}

export function extractGenericImageKey(url) {
	const raw = typeof url === "string" ? url.trim() : "";
	if (!raw) return null;
	let path = raw;
	try {
		if (/^https?:\/\//i.test(raw)) {
			path = new URL(raw).pathname;
		}
	} catch {
		path = raw;
	}
	const prefix = "/api/images/generic/";
	const idx = path.indexOf(prefix);
	if (idx < 0) return null;
	const tail = path.slice(idx + prefix.length).split(/[?#]/)[0];
	if (!tail) return null;
	const segments = tail.split("/").filter(Boolean).map((seg) => {
		try {
			return decodeURIComponent(seg);
		} catch {
			return seg;
		}
	});
	return segments.join("/") || null;
}

/** Keys written by profile-edit (and the same helper used by welcome / set-from-creation). */
export function isProcessedProfileAvatarKey(key, userId) {
	const raw = String(key || "").trim();
	const id = Number(userId);
	if (!raw || !Number.isFinite(id) || id <= 0) return false;
	return raw.startsWith(`profile/${id}/avatar_`) && raw.toLowerCase().endsWith(".webp");
}

export function isProcessedProfileAvatarUrl(url, userId) {
	return isProcessedProfileAvatarKey(extractGenericImageKey(url), userId);
}

export function newProfileAvatarStorageKey(userId) {
	const id = Number(userId);
	if (!Number.isFinite(id) || id <= 0) {
		throw new Error("Invalid user id");
	}
	const now = Date.now();
	const rand = Math.random().toString(36).slice(2, 9);
	return `profile/${id}/avatar_${now}_${rand}.webp`;
}

export function shouldDeleteOldProfileAvatarKey(oldKey) {
	return Boolean(oldKey);
}

export async function processProfileAvatarBuffer(buffer) {
	return sharp(buffer, { failOn: "none" })
		.rotate()
		.resize(PROFILE_AVATAR_SIZE, PROFILE_AVATAR_SIZE, {
			fit: "cover",
			position: "centre",
			withoutEnlargement: true
		})
		.webp({ quality: PROFILE_AVATAR_WEBP_QUALITY })
		.toBuffer();
}

/**
 * Center-crop to at most 256 WebP and store at profile/{userId}/avatar_{ts}_{rand}.webp.
 * Source bytes are not modified.
 */
export async function storeProcessedProfileAvatar(storage, userId, sourceBuffer) {
	if (!storage?.uploadGenericImage) {
		throw new Error("Generic images storage not available");
	}
	const resized = await processProfileAvatarBuffer(sourceBuffer);
	const key = newProfileAvatarStorageKey(userId);
	const stored = await storage.uploadGenericImage(resized, key, {
		contentType: PROFILE_AVATAR_CONTENT_TYPE
	});
	const finalKey = stored || key;
	return {
		key: finalKey,
		url: buildGenericImageUrl(finalKey),
		bytes: resized.length
	};
}
