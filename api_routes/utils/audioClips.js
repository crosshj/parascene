/** Shared helpers for prsn_audio_clips (owners in meta, storage URLs). */

import { mapCreatedImageRowMediaFields } from "./resolveCreationDisplayMedia.js";
import { ACTIVE_SHARE_VERSION, mintShareToken, verifyShareToken } from "./shareLink.js";
import { getShareBaseUrl } from "./url.js";

export const AUDIO_CLIP_MAX_BYTES = 20 * 1024 * 1024;

export const AUDIO_CLIP_SOURCE_TYPES = new Set(["video_extract", "recorded", "upload"]);

export function buildGenericAudioUrl(storageKey) {
	const segments = String(storageKey || "")
		.split("/")
		.filter(Boolean)
		.map((seg) => encodeURIComponent(seg));
	return `/api/images/generic/${segments.join("/")}`;
}

export function parseClipMeta(raw) {
	if (raw == null) return {};
	if (typeof raw === "object" && !Array.isArray(raw)) return raw;
	if (typeof raw !== "string" || !raw.trim()) return {};
	try {
		const o = JSON.parse(raw);
		return o && typeof o === "object" && !Array.isArray(o) ? o : {};
	} catch {
		return {};
	}
}

export function getClipOwners(meta) {
	const m = parseClipMeta(meta);
	const owners = m.owners && typeof m.owners === "object" ? m.owners : {};
	const creator = Number(owners.creator);
	const source = Number(owners.source);
	return {
		creator: Number.isFinite(creator) && creator > 0 ? creator : null,
		source: Number.isFinite(source) && source > 0 ? source : null
	};
}

export function isClipOwner(clip, userId) {
	const uid = Number(userId);
	if (!clip || !Number.isFinite(uid) || uid <= 0) return false;
	const { creator, source } = getClipOwners(clip.meta);
	return uid === creator || uid === source;
}

export function canEditClip(user, clip) {
	if (!user || !clip) return false;
	if (user.role === "admin") return true;
	const plan = user.meta?.plan ?? "free";
	if (plan === "founder") return true;
	return isClipOwner(clip, user.id);
}

export function buildClipOwnersMeta({ creatorUserId, sourceUserId = null }) {
	const creator = Number(creatorUserId);
	if (!Number.isFinite(creator) || creator <= 0) return { owners: {} };
	const owners = { creator };
	const source = Number(sourceUserId);
	if (Number.isFinite(source) && source > 0 && source !== creator) {
		owners.source = source;
	}
	return { owners };
}

export function mergeClipOwnersMeta(existingMeta, ownersPatch) {
	const base = parseClipMeta(existingMeta);
	const nextOwners = ownersPatch?.owners && typeof ownersPatch.owners === "object" ? ownersPatch.owners : {};
	return {
		...base,
		owners: { ...nextOwners }
	};
}

export function normalizeClipContentType(raw) {
	const ct = String(raw ?? "")
		.trim()
		.toLowerCase();
	if (!ct) return "audio/webm";
	if (ct.startsWith("audio/webm")) return "audio/webm";
	if (ct.startsWith("audio/ogg")) return "audio/ogg";
	if (ct.startsWith("audio/mp4") || ct.includes("m4a")) return "audio/mp4";
	if (ct.startsWith("audio/mpeg") || ct.startsWith("audio/mp3")) return "audio/mpeg";
	if (ct.startsWith("audio/")) return ct.split(";")[0].trim();
	return "audio/webm";
}

export function clipExtFromContentType(contentType) {
	const ct = normalizeClipContentType(contentType);
	if (ct === "audio/ogg") return "ogg";
	if (ct === "audio/mp4") return "m4a";
	if (ct === "audio/mpeg") return "mp3";
	return "webm";
}

export function formatAudioClipListRow(row, { includeAudioUrl = true } = {}) {
	if (!row || typeof row !== "object") return null;
	const meta = parseClipMeta(row.meta);
	const item = {
		id: row.id,
		title: row.title ?? "",
		description: typeof row.description === "string" ? row.description : "",
		duration_sec: row.duration_sec != null ? Number(row.duration_sec) : null,
		source_type: row.source_type ?? "",
		usage_count: Number(row.usage_count) || 0,
		last_used_at: row.last_used_at ?? null,
		thumb_url: typeof meta.thumb_url === "string" ? meta.thumb_url.trim() : "",
		thumb_creation_id:
			Number(meta.thumb_creation_id) > 0 ? Number(meta.thumb_creation_id) : null,
		source_created_image_id:
			Number(row.source_created_image_id) > 0 ? Number(row.source_created_image_id) : null,
		owners: getClipOwners(meta),
		created_at: row.created_at ?? null
	};
	if (includeAudioUrl && row.storage_key) {
		item.audio_url = buildGenericAudioUrl(row.storage_key);
	}
	return item;
}

/**
 * Resolve thumb_url for list rows: use meta.thumb_url, else source video creation thumbnail.
 * @param {object[]} formattedRows — output of formatAudioClipListRow
 * @param {object[]} rawRows — matching DB rows (same order)
 */
export async function enrichAudioClipRowsWithThumbnails(formattedRows, rawRows, queries, storage) {
	if (!Array.isArray(formattedRows) || !formattedRows.length) return formattedRows ?? [];
	const getCreation =
		queries.selectCreatedImageByIdAnyUser?.get ?? queries.selectCreatedImageById?.get ?? null;
	if (typeof getCreation !== "function") return formattedRows;

	const sourceIds = [
		...new Set(
			(Array.isArray(rawRows) ? rawRows : [])
				.map((row) => Number(row?.source_created_image_id))
				.filter((id) => Number.isFinite(id) && id > 0)
		)
	];
	const thumbBySourceId = new Map();
	await Promise.all(
		sourceIds.map(async (sourceId) => {
			try {
				const creation = await getCreation(sourceId);
				if (!creation) return;
				const media = mapCreatedImageRowMediaFields(creation, { storage, includeMeta: false });
				const thumb = typeof media.thumbnail_url === "string" ? media.thumbnail_url.trim() : "";
				const url = typeof media.url === "string" ? media.url.trim() : "";
				if (thumb || url) thumbBySourceId.set(sourceId, thumb || url);
			} catch {
				// ignore per-row lookup failures
			}
		})
	);

	return formattedRows.map((item, index) => {
		const raw = Array.isArray(rawRows) ? rawRows[index] : null;
		let thumb_url = typeof item?.thumb_url === "string" ? item.thumb_url.trim() : "";
		if (!thumb_url && raw) {
			const sourceId = Number(raw.source_created_image_id);
			if (Number.isFinite(sourceId) && sourceId > 0) {
				thumb_url = thumbBySourceId.get(sourceId) || "";
			}
		}
		const hasCustomThumb = Boolean(
			raw && typeof parseClipMeta(raw.meta).thumb_url === "string" && parseClipMeta(raw.meta).thumb_url.trim()
		);
		return thumb_url && thumb_url !== item.thumb_url
			? { ...item, thumb_url, has_custom_thumb: hasCustomThumb }
			: { ...item, has_custom_thumb: hasCustomThumb };
	});
}

export function buildAudioClipCreationSnapshot(clip) {
	if (!clip) return null;
	const meta = parseClipMeta(clip.meta);
	return {
		id: clip.id,
		title: String(clip.title ?? "").trim() || `Clip #${clip.id}`,
		duration_sec: clip.duration_sec != null ? Number(clip.duration_sec) : null,
		content_type: clip.content_type ?? "",
		thumb_url: typeof meta.thumb_url === "string" ? meta.thumb_url.trim() : "",
		source_type: clip.source_type ?? ""
	};
}

export function isFounderOrAdmin(user) {
	if (!user) return false;
	if (user.role === "admin") return true;
	return (user.meta?.plan ?? "free") === "founder";
}

export function shareUrlForAudioClip(clipId, sharedByUserId, baseUrl = null) {
	const id = Number(clipId);
	const uid = Number(sharedByUserId);
	if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(uid) || uid <= 0) return null;
	try {
		const token = mintShareToken({
			version: ACTIVE_SHARE_VERSION,
			imageId: id,
			sharedByUserId: uid
		});
		const base = (baseUrl || getShareBaseUrl() || "").replace(/\/$/, "");
		return `${base}/api/share/${encodeURIComponent(ACTIVE_SHARE_VERSION)}/${encodeURIComponent(token)}/clip-audio`;
	} catch {
		return null;
	}
}

export function shareUrlForCreationExtractedAudio(creationId, sharedByUserId, baseUrl = null) {
	const id = Number(creationId);
	const uid = Number(sharedByUserId);
	if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(uid) || uid <= 0) return null;
	try {
		const token = mintShareToken({
			version: ACTIVE_SHARE_VERSION,
			imageId: id,
			sharedByUserId: uid
		});
		const base = (baseUrl || getShareBaseUrl() || "").replace(/\/$/, "");
		return `${base}/api/share/${encodeURIComponent(ACTIVE_SHARE_VERSION)}/${encodeURIComponent(token)}/audio`;
	} catch {
		return null;
	}
}

/**
 * Validate clip ownership and attach provider-fetchable audio_url (+ audio_clip_id).
 * @returns {{ ok: true, args: object } | { ok: false, status: number, error: string }}
 */
export async function resolveAudioClipProviderArgs(queries, userId, args, providerBase = null) {
	const next = args && typeof args === "object" ? { ...args } : {};
	const clipId = Number(next.audio_clip_id);
	if (!Number.isFinite(clipId) || clipId <= 0) {
		if (next.audio_clip_id != null || next.audio_url) {
			return { ok: false, status: 400, error: "Invalid audio_clip_id" };
		}
		return { ok: true, args: next };
	}
	const clip = await queries.selectAudioClipById?.get(clipId);
	if (!clip) {
		return { ok: false, status: 404, error: "Audio clip not found" };
	}
	if (!isClipOwner(clip, userId)) {
		return { ok: false, status: 403, error: "Forbidden" };
	}
	const base = providerBase || getShareBaseUrl();
	let audioUrl = null;
	if (
		clip.source_type === "video_extract" &&
		clip.source_created_image_id != null &&
		Number(clip.source_created_image_id) > 0
	) {
		audioUrl = shareUrlForCreationExtractedAudio(clip.source_created_image_id, userId, base);
	}
	if (!audioUrl) {
		audioUrl = shareUrlForAudioClip(clip.id, userId, base);
	}
	if (!audioUrl) {
		return { ok: false, status: 500, error: "Failed to build audio URL for provider" };
	}
	next.audio_clip_id = clip.id;
	next.audio_url = audioUrl;
	if (
		Object.prototype.hasOwnProperty.call(next, "input_audio_urls") ||
		Object.prototype.hasOwnProperty.call(next, "input_audio_url")
	) {
		next.input_audio_urls = audioUrl;
		if (Object.prototype.hasOwnProperty.call(next, "input_audio_url")) {
			next.input_audio_url = audioUrl;
		}
	} else {
		next.input_audio_urls = audioUrl;
	}
	return { ok: true, args: next, clip };
}

/** Parse numeric creation id from pasted link, path, or plain digits. */
export function parseCreationIdFromLink(raw) {
	const s = String(raw ?? "").trim();
	if (!s) return null;
	const onlyDigits = /^\d+$/.exec(s);
	if (onlyDigits) {
		const n = parseInt(onlyDigits[0], 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	}
	try {
		const u = new URL(s, "https://www.parascene.com");
		const m = u.pathname.match(/\/creations\/(\d+)/);
		if (m) {
			const n = parseInt(m[1], 10);
			return Number.isFinite(n) && n > 0 ? n : null;
		}
	} catch {
		// ignore
	}
	const m2 = s.match(/\/creations\/(\d+)/);
	if (m2) {
		const n = parseInt(m2[1], 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	}
	return null;
}

/** Parse /api/images/generic/… into a storage key (share-audio/… or prompt-audio/…). */
export function parseGenericStorageKeyFromUrl(rawUrl) {
	const raw = String(rawUrl || "").trim();
	if (!raw) return null;
	try {
		const u = new URL(raw, "http://localhost");
		const prefix = "/api/images/generic/";
		if (!u.pathname.startsWith(prefix)) return null;
		const segments = u.pathname
			.slice(prefix.length)
			.split("/")
			.filter(Boolean)
			.map((seg) => decodeURIComponent(seg));
		return segments.length ? segments.join("/") : null;
	} catch {
		const idx = raw.indexOf("/api/images/generic/");
		if (idx === -1) return null;
		const pathPart = raw.slice(idx + "/api/images/generic/".length).split(/[?#]/)[0];
		const segments = pathPart
			.split("/")
			.filter(Boolean)
			.map((seg) => {
				try {
					return decodeURIComponent(seg);
				} catch {
					return seg;
				}
			});
		return segments.length ? segments.join("/") : null;
	}
}

/**
 * Resolve a provider/share/generic audio URL to a clip id (for usage backfill).
 * @returns {Promise<number|null>}
 */
export async function resolveClipIdFromAudioUrl(queries, audioUrl) {
	const raw = String(audioUrl || "").trim();
	if (!raw) return null;

	const clipAudioMatch = raw.match(/\/api\/share\/([^/]+)\/([^/?#]+)\/clip-audio(?:[/?#]|$)/);
	if (clipAudioMatch) {
		const verified = verifyShareToken({ version: clipAudioMatch[1], token: clipAudioMatch[2] });
		if (verified.ok && Number(verified.imageId) > 0) return Number(verified.imageId);
	}

	const creationAudioMatch = raw.match(/\/api\/share\/([^/]+)\/([^/?#]+)\/audio(?:[/?#]|$)/);
	if (creationAudioMatch) {
		const verified = verifyShareToken({
			version: creationAudioMatch[1],
			token: creationAudioMatch[2]
		});
		if (verified.ok && Number(verified.imageId) > 0) {
			const clip = await queries.selectAudioClipBySourceCreatedImageId?.get(verified.imageId);
			return clip?.id != null ? Number(clip.id) : null;
		}
	}

	const storageKey = parseGenericStorageKeyFromUrl(raw);
	if (storageKey) {
		const clip = await queries.selectAudioClipByStorageKey?.get(storageKey);
		return clip?.id != null ? Number(clip.id) : null;
	}

	return null;
}

/** Audio URL(s) from provider args (audio2video uses input_audio_urls). */
export function collectAudioUrlsFromArgs(args) {
	if (!args || typeof args !== "object") return [];
	const urls = [];
	const add = (raw) => {
		const s = typeof raw === "string" ? raw.trim() : "";
		if (s) urls.push(s);
	};
	add(args.audio_url);
	add(args.input_audio_url);
	const multi = args.input_audio_urls;
	if (typeof multi === "string") add(multi);
	else if (Array.isArray(multi)) {
		for (const item of multi) add(item);
	}
	return urls;
}

/**
 * Resolve clip id from an output creation meta (args + snapshot).
 * @returns {Promise<number|null>}
 */
export async function resolveClipIdFromOutputMeta(queries, meta) {
	if (!meta || typeof meta !== "object") return null;
	const args = meta.args && typeof meta.args === "object" ? meta.args : null;
	const fromArgs = Number(args?.audio_clip_id);
	if (Number.isFinite(fromArgs) && fromArgs > 0) return fromArgs;
	const fromSnapshot = Number(meta.audio_clip?.id);
	if (Number.isFinite(fromSnapshot) && fromSnapshot > 0) return fromSnapshot;
	if (args && typeof args.audio_url === "string" && args.audio_url.trim()) {
		const id = await resolveClipIdFromAudioUrl(queries, args.audio_url.trim());
		if (id) return id;
	}
	for (const url of collectAudioUrlsFromArgs(args)) {
		const id = await resolveClipIdFromAudioUrl(queries, url);
		if (id) return id;
	}
	return null;
}
