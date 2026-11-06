import sharp from "sharp";
import {
	createPlaceholderImageBuffer,
} from "./creationJob.js";
import { fetchImportCoverImageBuffer } from "./importCoverImage.js";
import { getSupabaseServiceClient } from "./supabaseService.js";
import {
	normalizeYoutubeUrl,
	resolveYoutubeVideoFromUrl,
} from "./youtubeResolve.js";

/**
 * YouTube default thumbs often include pure-black letterbox/pillarbox bars.
 * Trim those so grid covers behave like normal landscape images (fill via cover).
 * @param {Buffer} pngBuffer
 * @returns {Promise<Buffer>}
 */
async function trimYoutubeCoverLetterbox(pngBuffer) {
	try {
		const before = await sharp(pngBuffer, { failOn: "none" }).metadata();
		const trimmed = await sharp(pngBuffer, { failOn: "none" })
			.trim({
				background: { r: 0, g: 0, b: 0, alpha: 1 },
				threshold: 18,
			})
			.png()
			.toBuffer();
		const after = await sharp(trimmed, { failOn: "none" }).metadata();
		const beforeArea =
			(Number(before.width) || 0) * (Number(before.height) || 0);
		const afterArea = (Number(after.width) || 0) * (Number(after.height) || 0);
		// Guard against over-trim on mostly-dark frames.
		if (!afterArea || (beforeArea > 0 && afterArea < beforeArea * 0.2)) {
			return pngBuffer;
		}
		return trimmed;
	} catch {
		return pngBuffer;
	}
}

/**
 * Center-crop to 9:16 so Shorts covers match app portrait creations in the grid.
 * @param {Buffer} pngBuffer
 * @returns {Promise<Buffer>}
 */
async function centerCropCoverTo916(pngBuffer) {
	try {
		const meta = await sharp(pngBuffer, { failOn: "none" }).metadata();
		const width = Number(meta.width) || 0;
		const height = Number(meta.height) || 0;
		if (width <= 0 || height <= 0) return pngBuffer;

		const targetRatio = 9 / 16;
		const currentRatio = width / height;
		let extractWidth = width;
		let extractHeight = height;
		let left = 0;
		let top = 0;

		if (currentRatio > targetRatio) {
			// Too wide — crop sides.
			extractWidth = Math.max(1, Math.round(height * targetRatio));
			left = Math.max(0, Math.floor((width - extractWidth) / 2));
		} else if (currentRatio < targetRatio) {
			// Too tall — crop top/bottom.
			extractHeight = Math.max(1, Math.round(width / targetRatio));
			top = Math.max(0, Math.floor((height - extractHeight) / 2));
		} else {
			return await sharp(pngBuffer, { failOn: "none" }).png().toBuffer();
		}

		return await sharp(pngBuffer, { failOn: "none" })
			.extract({
				left,
				top,
				width: Math.min(extractWidth, width - left),
				height: Math.min(extractHeight, height - top),
			})
			.png()
			.toBuffer();
	} catch {
		return pngBuffer;
	}
}

/**
 * Center-crop to 16:9 after letterbox trim for regular watch URLs.
 * @param {Buffer} pngBuffer
 * @returns {Promise<Buffer>}
 */
async function normalizeRegularYoutubeCover(pngBuffer) {
	const trimmed = await trimYoutubeCoverLetterbox(pngBuffer);
	try {
		const meta = await sharp(trimmed, { failOn: "none" }).metadata();
		const width = Number(meta.width) || 0;
		const height = Number(meta.height) || 0;
		if (width <= 0 || height <= 0) return trimmed;

		const targetRatio = 16 / 9;
		const currentRatio = width / height;
		// Already close to 16:9 after trim — keep.
		if (Math.abs(currentRatio - targetRatio) < 0.04) {
			return trimmed;
		}

		let extractWidth = width;
		let extractHeight = height;
		let left = 0;
		let top = 0;
		if (currentRatio > targetRatio) {
			extractWidth = Math.max(1, Math.round(height * targetRatio));
			left = Math.max(0, Math.floor((width - extractWidth) / 2));
		} else {
			extractHeight = Math.max(1, Math.round(width / targetRatio));
			top = Math.max(0, Math.floor((height - extractHeight) / 2));
		}

		return await sharp(trimmed, { failOn: "none" })
			.extract({
				left,
				top,
				width: Math.min(extractWidth, width - left),
				height: Math.min(extractHeight, height - top),
			})
			.png()
			.toBuffer();
	} catch {
		return trimmed;
	}
}

/**
 * YouTube serves a tiny 120×90 stub for missing maxresdefault (HTTP 200).
 * Reject those so we fall through to the next candidate.
 * @param {Buffer} pngBuffer
 * @returns {Promise<boolean>}
 */
async function isUsableYoutubeCoverBuffer(pngBuffer) {
	try {
		const meta = await sharp(pngBuffer, { failOn: "none" }).metadata();
		const width = Number(meta.width) || 0;
		const height = Number(meta.height) || 0;
		return width >= 240 && height >= 240;
	} catch {
		return false;
	}
}

/**
 * Upscale cropped covers toward layout targets so Shorts/grid work isn't stuck
 * at ~400px after a 9:16 crop of a 1280×720 frame.
 * @param {Buffer} pngBuffer
 * @param {{ width: number, height: number }} target
 * @returns {Promise<Buffer>}
 */
async function upscaleCoverTowardTarget(pngBuffer, target) {
	const targetWidth = Number(target?.width) || 0;
	const targetHeight = Number(target?.height) || 0;
	if (targetWidth <= 0 || targetHeight <= 0) return pngBuffer;
	try {
		const meta = await sharp(pngBuffer, { failOn: "none" }).metadata();
		const width = Number(meta.width) || 0;
		const height = Number(meta.height) || 0;
		if (width <= 0 || height <= 0) return pngBuffer;
		if (width >= targetWidth && height >= targetHeight) return pngBuffer;
		return await sharp(pngBuffer, { failOn: "none" })
			.resize(targetWidth, targetHeight, {
				fit: "fill",
				kernel: sharp.kernel.lanczos3,
			})
			.png()
			.toBuffer();
	} catch {
		return pngBuffer;
	}
}

async function fetchYoutubeCoverBuffer(resolved) {
	const candidates = Array.isArray(resolved?.thumbnailCandidates)
		? resolved.thumbnailCandidates.filter((u) => typeof u === "string" && u.trim())
		: [];
	if (
		typeof resolved?.thumbnailUrl === "string" &&
		resolved.thumbnailUrl.trim() &&
		!candidates.includes(resolved.thumbnailUrl.trim())
	) {
		// Prefer high-res id candidates first; oEmbed/hqdefault last.
		candidates.push(resolved.thumbnailUrl.trim());
	}

	const isShorts = Boolean(resolved?.isShorts);

	for (const url of candidates) {
		try {
			const raw = await fetchImportCoverImageBuffer(url, {
				userAgent: "parascene-youtube-import",
			});
			if (!(await isUsableYoutubeCoverBuffer(raw))) continue;
			if (isShorts) {
				const cropped = await centerCropCoverTo916(raw);
				return await upscaleCoverTowardTarget(cropped, { width: 1080, height: 1920 });
			}
			const normalized = await normalizeRegularYoutubeCover(raw);
			return await upscaleCoverTowardTarget(normalized, { width: 1280, height: 720 });
		} catch {
			// try next candidate
		}
	}
	return null;
}

async function findExistingYoutubeImportId(userId, videoId) {
	const supabase = getSupabaseServiceClient();
	if (!supabase) return null;
	try {
		const { data, error } = await supabase
			.from("prsn_created_images")
			.select("id")
			.eq("user_id", userId)
			.filter("meta->import->>provider", "eq", "youtube")
			.filter("meta->import->>video_id", "eq", videoId)
			.is("unavailable_at", null)
			.order("created_at", { ascending: false })
			.limit(1)
			.maybeSingle();
		if (error) return null;
		const id = Number(data?.id);
		return Number.isFinite(id) && id > 0 ? id : null;
	} catch {
		return null;
	}
}

/**
 * Resolve a YouTube URL and check whether this user already imported the video.
 * @param {{ userId: number, url: string }} params
 */
export async function previewYoutubeImport({ userId, url }) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) {
		const err = new Error("Unauthorized");
		err.status = 401;
		throw err;
	}

	const rawUrl = typeof url === "string" ? url.trim() : "";
	if (!rawUrl || !normalizeYoutubeUrl(rawUrl)) {
		const err = new Error("Paste a YouTube video link");
		err.status = 400;
		err.code = "INVALID_YOUTUBE_URL";
		throw err;
	}

	let resolved;
	try {
		resolved = await resolveYoutubeVideoFromUrl(rawUrl);
	} catch (err) {
		if (!err.status) err.status = 502;
		throw err;
	}

	const existingId = await findExistingYoutubeImportId(uid, resolved.videoId);
	return {
		videoId: resolved.videoId,
		title: resolved.title || "",
		url: resolved.url,
		cover_url: resolved.thumbnailUrl || "",
		existing_id: existingId,
		is_shorts: Boolean(resolved.isShorts),
	};
}

/**
 * Import a YouTube URL as a completed video creation (cover + embed meta).
 * No hosted video file — playback is click-to-play embed on detail.
 *
 * @param {{
 *   userId: number,
 *   url: string,
 *   creationToken?: string,
 *   queries: object,
 *   storage: { uploadImage?: Function },
 * }} params
 */
export async function importYoutubeCreation({ userId, url, creationToken, queries, storage }) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) {
		const err = new Error("Unauthorized");
		err.status = 401;
		throw err;
	}
	if (typeof storage?.uploadImage !== "function") {
		const err = new Error("Image upload not available");
		err.status = 503;
		throw err;
	}
	if (typeof queries?.insertCreatedImage?.run !== "function") {
		const err = new Error("Create storage not available");
		err.status = 503;
		throw err;
	}

	const rawUrl = typeof url === "string" ? url.trim() : "";
	if (!rawUrl || !normalizeYoutubeUrl(rawUrl)) {
		const err = new Error("Paste a YouTube video link");
		err.status = 400;
		err.code = "INVALID_YOUTUBE_URL";
		throw err;
	}

	let resolved;
	try {
		resolved = await resolveYoutubeVideoFromUrl(rawUrl);
	} catch (err) {
		if (!err.status) err.status = 502;
		throw err;
	}

	const existingId = await findExistingYoutubeImportId(uid, resolved.videoId);
	const isShorts = Boolean(resolved.isShorts);

	let coverBuffer = null;
	let usedPlaceholder = false;
	coverBuffer = await fetchYoutubeCoverBuffer(resolved);
	if (!coverBuffer) {
		coverBuffer = await createPlaceholderImageBuffer();
		usedPlaceholder = true;
	}

	// Locked layout targets — prefer these dims even if sharp reads differ slightly.
	let width = isShorts ? 1080 : 1280;
	let height = isShorts ? 1920 : 720;
	try {
		const metaSharp = await sharp(coverBuffer, { failOn: "none" }).metadata();
		if (typeof metaSharp.width === "number" && metaSharp.width > 0) width = metaSharp.width;
		if (typeof metaSharp.height === "number" && metaSharp.height > 0) height = metaSharp.height;
	} catch {
		// keep defaults
	}

	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 9);
	const filename = `${uid}_${timestamp}_${random}.png`;
	const filePath = await storage.uploadImage(coverBuffer, filename);

	const title =
		typeof resolved.title === "string" && resolved.title.trim()
			? resolved.title.trim().slice(0, 200)
			: null;

	const meta = {
		media_type: "video",
		import: {
			provider: "youtube",
			video_id: resolved.videoId,
			url: resolved.url,
			embed_url: resolved.embedUrl,
			title: resolved.title || "",
			creator: resolved.creator || "",
			kind: isShorts ? "shorts" : "watch",
		},
		completed_at: new Date().toISOString(),
		...(usedPlaceholder ? { cover_placeholder: true } : {}),
		...(typeof creationToken === "string" && creationToken.trim()
			? { creation_token: creationToken.trim() }
			: {}),
	};

	const insertResult = await queries.insertCreatedImage.run(
		uid,
		filename,
		filePath,
		width,
		height,
		null,
		"completed",
		meta
	);
	const creationId = Number(insertResult?.insertId);
	if (!Number.isFinite(creationId) || creationId <= 0) {
		const err = new Error("Failed to create video");
		err.status = 500;
		throw err;
	}

	if (title && typeof queries.updateCreatedImage?.run === "function") {
		try {
			await queries.updateCreatedImage.run(creationId, uid, title, null, false);
		} catch {
			// Title is best-effort
		}
	}

	return {
		id: creationId,
		status: "completed",
		media_type: "video",
		title: title || "",
		url: filePath,
		warning: existingId
			? {
					code: "duplicate_import",
					message: "You already imported this video",
					existing_id: existingId,
				}
			: null,
	};
}

function youtubeImportUrlFromMeta(meta) {
	const importMeta =
		meta?.import && typeof meta.import === "object" && !Array.isArray(meta.import)
			? meta.import
			: null;
	if (!importMeta) return null;
	if (String(importMeta.provider || "").trim().toLowerCase() !== "youtube") return null;

	const storedUrl = typeof importMeta.url === "string" ? importMeta.url.trim() : "";
	if (storedUrl && normalizeYoutubeUrl(storedUrl)) return storedUrl;

	const videoId =
		typeof importMeta.video_id === "string" ? importMeta.video_id.trim() : "";
	if (!videoId || !/^[a-zA-Z0-9_-]{6,}$/.test(videoId)) return null;

	const kind = String(importMeta.kind || "").trim().toLowerCase();
	if (kind === "shorts") {
		return `https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`;
	}
	return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/**
 * Re-fetch the YouTube cover for an existing import and overwrite file_path.
 * Used on edit/save so older imports pick up higher-res thumbs.
 *
 * @param {{
 *   imageId: number,
 *   userId: number,
 *   meta?: object,
 *   color?: unknown,
 *   queries: object,
 *   storage: { uploadImage?: Function },
 * }} params
 * @returns {Promise<null | { url: string, width: number, height: number, meta: object }>}
 */
export async function refreshYoutubeImportCover({
	imageId,
	userId,
	meta,
	color,
	queries,
	storage,
}) {
	const id = Number(imageId);
	const uid = Number(userId);
	if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(uid) || uid <= 0) return null;
	if (typeof storage?.uploadImage !== "function") return null;
	if (typeof queries?.updateCreatedImageJobCompleted?.run !== "function") return null;

	const currentMeta =
		meta && typeof meta === "object" && !Array.isArray(meta) ? { ...meta } : {};
	const rawUrl = youtubeImportUrlFromMeta(currentMeta);
	if (!rawUrl) return null;

	let resolved;
	try {
		resolved = await resolveYoutubeVideoFromUrl(rawUrl);
	} catch {
		return null;
	}

	const coverBuffer = await fetchYoutubeCoverBuffer(resolved);
	if (!coverBuffer) return null;

	const isShorts = Boolean(resolved.isShorts);
	let width = isShorts ? 1080 : 1280;
	let height = isShorts ? 1920 : 720;
	try {
		const metaSharp = await sharp(coverBuffer, { failOn: "none" }).metadata();
		if (typeof metaSharp.width === "number" && metaSharp.width > 0) width = metaSharp.width;
		if (typeof metaSharp.height === "number" && metaSharp.height > 0) height = metaSharp.height;
	} catch {
		// keep defaults
	}

	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 9);
	const filename = `${uid}_${id}_${timestamp}_${random}.png`;
	const filePath = await storage.uploadImage(coverBuffer, filename);

	const prevImport =
		currentMeta.import && typeof currentMeta.import === "object" && !Array.isArray(currentMeta.import)
			? currentMeta.import
			: {};
	const nextMeta = {
		...currentMeta,
		media_type: "video",
		import: {
			...prevImport,
			provider: "youtube",
			video_id: resolved.videoId || prevImport.video_id || "",
			url: resolved.url || prevImport.url || rawUrl,
			embed_url: resolved.embedUrl || prevImport.embed_url || "",
			title:
				(typeof resolved.title === "string" && resolved.title.trim()) ||
				prevImport.title ||
				"",
			creator:
				(typeof resolved.creator === "string" && resolved.creator.trim()) ||
				prevImport.creator ||
				"",
			kind: isShorts ? "shorts" : "watch",
		},
	};
	delete nextMeta.cover_placeholder;

	const updateResult = await queries.updateCreatedImageJobCompleted.run(id, uid, {
		filename,
		file_path: filePath,
		width,
		height,
		color: color ?? null,
		meta: nextMeta,
	});
	if (!updateResult || Number(updateResult.changes) === 0) return null;

	return {
		url: filePath,
		width,
		height,
		meta: nextMeta,
	};
}
