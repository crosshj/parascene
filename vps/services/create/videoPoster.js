import sharp from "sharp";
import { parseCreationMeta } from "./audioCoverApply.js";

/**
 * Owner/admin may replace the still on any completed video, any method or aspect.
 * Group rows keep their own cover action.
 * @param {{ status?: unknown, media_type?: unknown, meta?: unknown } | null | undefined} image
 * @returns {boolean}
 */
export function creationRowCanSetVideoPoster(image) {
	if (!image || String(image.status || "").toLowerCase() !== "completed") return false;
	const meta = parseCreationMeta(image.meta) || {};
	const group = meta.group;
	if (group && typeof group === "object" && group.kind === "group_creations") return false;
	const media = String(meta.media_type || image.media_type || "").trim().toLowerCase();
	if (media === "video") return true;
	if (meta.video && typeof meta.video === "object") return true;
	const filePath = typeof meta.file_path === "string" ? meta.file_path.trim() : "";
	if (filePath.startsWith("/api/videos/created/")) return true;
	const videoFilename = typeof meta.video_filename === "string" ? meta.video_filename : "";
	return videoFilename.startsWith("video/");
}

/**
 * Store an uploaded frame as the creation's poster.
 * @param {{ queries: object, storage: { uploadImage?: Function }, image: object, buffer: Buffer, targetWidth?: number, targetHeight?: number }} params
 */
export async function applyVideoPosterBuffer({ queries, storage, image, buffer, targetWidth, targetHeight }) {
	if (!image || typeof storage?.uploadImage !== "function") {
		const err = new Error("Poster storage is not available");
		err.status = 503;
		throw err;
	}
	if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
		const err = new Error("No image file provided; use form field name 'image'");
		err.status = 400;
		throw err;
	}
	let pngBuffer;
	try {
		pngBuffer = await sharp(buffer, { failOn: "none" }).png().toBuffer();
	} catch {
		const err = new Error("File must be an image");
		err.status = 400;
		throw err;
	}
	const sharpMeta = await sharp(pngBuffer).metadata();
	let width = Number(sharpMeta.width);
	let height = Number(sharpMeta.height);
	if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
		const err = new Error("Could not read image dimensions");
		err.status = 400;
		throw err;
	}
	const hasTargetDims =
		Number.isFinite(targetWidth) &&
		targetWidth > 0 &&
		Number.isFinite(targetHeight) &&
		targetHeight > 0;
	if (hasTargetDims && (width !== targetWidth || height !== targetHeight)) {
		pngBuffer = await sharp(pngBuffer)
			.resize(Math.round(targetWidth), Math.round(targetHeight), { fit: "fill" })
			.png()
			.toBuffer();
		width = Math.round(targetWidth);
		height = Math.round(targetHeight);
	}
	const timestamp = Date.now();
	const random = Math.random().toString(36).slice(2, 9);
	const filename = `${image.user_id}_${image.id}_${timestamp}_${random}.png`;
	const filePath = await storage.uploadImage(pngBuffer, filename);
	const existingMeta = parseCreationMeta(image.meta) || {};
	const nextMeta = {
		...existingMeta,
		video_placeholder_manual: true,
	};
	const updateResult = await queries.updateCreatedImageJobCompleted.run(image.id, image.user_id, {
		filename,
		file_path: filePath,
		width,
		height,
		color: image.color ?? null,
		meta: nextMeta,
	});
	if (!updateResult || updateResult.changes === 0) {
		const err = new Error("Failed to update creation poster");
		err.status = 500;
		throw err;
	}
	return { filename, file_path: filePath, width, height, meta: nextMeta };
}
