import {
	parseCreationMeta,
	extractFilenameFromCreatedImagePath
} from "./resolveCreatedImageStorageFilename.js";
import { appendCreationIdToMediaUrl, getFitThumbnailUrl, getThumbnailUrl } from "./url.js";

export function getGroupCoverSource(meta) {
	const groupPayload = meta?.group && typeof meta.group === "object" ? meta.group : null;
	if (groupPayload?.kind !== "group_creations") return null;
	const sourcesRaw = Array.isArray(groupPayload.source_creations) ? groupPayload.source_creations : [];
	const coverId = Number(groupPayload.cover_source_id);
	let coverSource = null;
	if (Number.isFinite(coverId) && coverId > 0) {
		coverSource = sourcesRaw.find((s) => s && typeof s === "object" && Number(s.id) === coverId) || null;
	}
	if (!coverSource) {
		coverSource = sourcesRaw.find((s) => s && typeof s === "object") || null;
	}
	return coverSource || null;
}

function resolveSourceFilePath(source, storage) {
	if (!source || typeof source !== "object") return null;
	let filePath = typeof source.file_path === "string" ? source.file_path.trim() : "";
	if (!filePath) {
		const filename = typeof source.filename === "string" ? source.filename.trim() : "";
		if (filename && !filename.startsWith("group/") && storage?.getImageUrl) {
			filePath = storage.getImageUrl(filename);
		}
	}
	return filePath || null;
}

function resolveRowFilePath(row, storage) {
	const filePath = typeof row?.file_path === "string" ? row.file_path.trim() : "";
	if (filePath) return filePath;
	const filename = typeof row?.filename === "string" ? row.filename.trim() : "";
	if (filename && storage?.getImageUrl) {
		return storage.getImageUrl(filename);
	}
	const urlField = typeof row?.url === "string" ? row.url.trim() : "";
	return urlField || null;
}

function isSyntheticGroupPath(value) {
	const s = typeof value === "string" ? value.trim() : "";
	if (!s) return false;
	if (s.includes("/group/") || s.includes("group/")) return true;
	const fromPath = extractFilenameFromCreatedImagePath(s);
	return Boolean(fromPath && fromPath.startsWith("group/"));
}

export function resolveCreationMediaType(meta, rowMediaType) {
	if (typeof meta?.media_type === "string" && meta.media_type.trim()) {
		return meta.media_type.trim();
	}
	if (typeof rowMediaType === "string" && rowMediaType.trim()) {
		return rowMediaType.trim();
	}
	return "image";
}

/**
 * Resolve viewer-facing media URLs for a creation row (incl. grouped cover / group video).
 * @param {{ row?: object, meta?: object|null, storage?: { getImageUrl?: (filename: string) => string }, creationId?: number }} params
 */
export function resolveCreationDisplayMediaUrls({ row = {}, meta: metaIn = null, storage = null, creationId: idIn = null } = {}) {
	const meta = metaIn ?? parseCreationMeta(row?.meta);
	const creationId = Number(idIn ?? row?.id ?? row?.created_image_id);
	const mediaType = resolveCreationMediaType(meta, row?.media_type);

	const coverSource = getGroupCoverSource(meta);
	const rowPath = resolveRowFilePath(row, storage);
	const useCover =
		coverSource &&
		(isSyntheticGroupPath(row?.filename) ||
			isSyntheticGroupPath(rowPath) ||
			!rowPath);

	let rawImageUrl = rowPath;
	let sourceMeta = meta;
	if (useCover) {
		rawImageUrl = resolveSourceFilePath(coverSource, storage) || rowPath;
		sourceMeta =
			coverSource?.meta && typeof coverSource.meta === "object" ? coverSource.meta : meta;
	}

	if (!rawImageUrl && typeof row?.image_url === "string" && row.image_url.trim()) {
		rawImageUrl = row.image_url.trim();
	}

	const url =
		rawImageUrl && Number.isFinite(creationId) && creationId > 0
			? appendCreationIdToMediaUrl(rawImageUrl, creationId)
			: rawImageUrl || null;

	const videoMeta = sourceMeta && typeof sourceMeta === "object" ? sourceMeta.video : null;
	const rawVideoUrl =
		typeof row?.video_url === "string" && row.video_url.trim()
			? row.video_url.trim()
			: videoMeta && typeof videoMeta.file_path === "string" && videoMeta.file_path.trim()
				? videoMeta.file_path.trim()
				: null;
	const videoUrl =
		rawVideoUrl && Number.isFinite(creationId) && creationId > 0
			? appendCreationIdToMediaUrl(rawVideoUrl, creationId)
			: rawVideoUrl;

	return {
		url,
		thumbnail_url: url ? getThumbnailUrl(url) : null,
		fit_thumbnail_url: url ? getFitThumbnailUrl(url) : null,
		video_url: videoUrl || null,
		media_type: mediaType
	};
}

/**
 * Map a created_images row (or feed row) to client media fields with group-aware URLs.
 * @param {object} img
 * @param {{ storage?: { getImageUrl?: (filename: string) => string }, includeMeta?: boolean }} [options]
 */
export function mapCreatedImageRowMediaFields(img, { storage = null, includeMeta = true } = {}) {
	const meta = parseCreationMeta(img?.meta);
	const creationId = Number(img?.id ?? img?.created_image_id);
	const media = resolveCreationDisplayMediaUrls({ row: img, meta, storage, creationId });
	const out = {
		url: media.url,
		thumbnail_url: media.thumbnail_url,
		fit_thumbnail_url: media.fit_thumbnail_url,
		video_url: media.video_url,
		media_type: media.media_type
	};
	if (includeMeta) {
		out.meta = meta && typeof meta === "object" ? meta : null;
	}
	return out;
}
