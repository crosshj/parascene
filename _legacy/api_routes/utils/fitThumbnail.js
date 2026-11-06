import path from "path";
import sharp from "sharp";
import {
	ASPECT_RATIO_PRESETS,
	MVP_ASPECT_RATIO_KEYS,
	closestAspectRatioPreset,
	parseAspectRatioString,
} from "../../public/shared/aspectRatio.js";

/** Long edge for native-aspect (`fit`) board thumbs. */
export const FIT_THUMB_LONG_EDGE = 720;
/** Square cover thumb (`?variant=thumbnail`). */
export const SQUARE_THUMB_SIZE = 250;
export const CREATED_THUMB_WEBP_QUALITY = 82;
/** @deprecated Use CREATED_THUMB_WEBP_QUALITY — fit thumbs are WebP now. */
export const FIT_THUMB_JPEG_QUALITY = CREATED_THUMB_WEBP_QUALITY;

/**
 * Storage key for native-aspect fit thumb in the thumbnail bucket.
 * Square thumb keeps the full-image filename; fit still uses `{base}_fit.jpg`
 * as the object key (bytes are WebP; URLs stay `?variant=fit`).
 * @param {string} filename — full image or square-thumb storage key
 * @returns {string}
 */
export function fitThumbnailStorageKey(filename) {
	const raw = String(filename || "").trim();
	if (!raw) return "";
	const ext = path.extname(raw);
	const dir = path.dirname(raw);
	const base = path.basename(raw, ext);
	const key = `${base}_fit.jpg`;
	return dir && dir !== "." ? path.join(dir, key) : key;
}

/**
 * True when pixel dims (or closest MVP preset) are square — skip fit generation.
 * @param {number} width
 * @param {number} height
 */
export function shouldGenerateFitThumbnail(width, height) {
	return closestAspectRatioPreset(width, height) !== "1:1";
}

/**
 * Build a native-aspect WebP thumb (long edge FIT_THUMB_LONG_EDGE).
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
export async function buildFitThumbnailBuffer(buffer) {
	const img = sharp(buffer, { failOn: "none" });
	const meta = await img.metadata();
	const w = Number(meta.width) || 0;
	const h = Number(meta.height) || 0;
	if (w <= 0 || h <= 0) {
		throw new Error("Could not read image dimensions for fit thumbnail");
	}
	const max = Math.max(w, h);
	let pipeline = img;
	if (max > FIT_THUMB_LONG_EDGE) {
		const scale = FIT_THUMB_LONG_EDGE / max;
		const nw = Math.max(1, Math.round(w * scale));
		const nh = Math.max(1, Math.round(h * scale));
		pipeline = pipeline.resize(nw, nh, { fit: "inside", withoutEnlargement: true });
	}
	return pipeline.webp({ quality: CREATED_THUMB_WEBP_QUALITY }).toBuffer();
}

/**
 * Build a 250×250 cover-crop WebP thumb (`?variant=thumbnail`).
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
export async function buildSquareThumbnailBuffer(buffer) {
	return sharp(buffer, { failOn: "none" })
		.rotate()
		.resize(SQUARE_THUMB_SIZE, SQUARE_THUMB_SIZE, { fit: "cover", position: "centre" })
		.webp({ quality: CREATED_THUMB_WEBP_QUALITY })
		.toBuffer();
}

/**
 * @param {Buffer|null|undefined} buffer
 * @returns {string}
 */
export function sniffImageContentType(buffer) {
	if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) {
		return "application/octet-stream";
	}
	if (
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47
	) {
		return "image/png";
	}
	if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
	if (
		buffer[0] === 0x52 &&
		buffer[1] === 0x49 &&
		buffer[2] === 0x46 &&
		buffer[3] === 0x46 &&
		buffer[8] === 0x57 &&
		buffer[9] === 0x45 &&
		buffer[10] === 0x42 &&
		buffer[11] === 0x50
	) {
		return "image/webp";
	}
	return "application/octet-stream";
}

/**
 * Resolve an MVP aspect_ratio string for a group from its first / cover source.
 * Prefers the source's creative `meta.args.aspect_ratio` when it is an MVP preset;
 * otherwise closest preset from width/height.
 * @param {{ width?: unknown, height?: unknown, meta?: unknown } | null | undefined} firstSource
 * @returns {string}
 */
export function aspectRatioForGroupFirstSource(firstSource) {
	const meta =
		firstSource?.meta && typeof firstSource.meta === "object" ? firstSource.meta : null;
	const args = meta?.args && typeof meta.args === "object" ? meta.args : null;
	const raw = typeof args?.aspect_ratio === "string" ? args.aspect_ratio.trim() : "";
	if (raw && MVP_ASPECT_RATIO_KEYS.includes(raw) && ASPECT_RATIO_PRESETS[raw]) {
		return raw;
	}
	if (raw && parseAspectRatioString(raw) && MVP_ASPECT_RATIO_KEYS.includes(raw)) {
		return raw;
	}
	return closestAspectRatioPreset(firstSource?.width, firstSource?.height);
}

/**
 * Apply `meta.args.aspect_ratio` for a group from its first listed source.
 * @param {object} meta
 * @param {{ width?: unknown, height?: unknown, meta?: unknown } | null | undefined} firstSource
 * @returns {object}
 */
export function withGroupAspectRatioFromFirst(meta, firstSource) {
	const base = meta && typeof meta === "object" ? { ...meta } : {};
	const args = base.args && typeof base.args === "object" ? { ...base.args } : {};
	args.aspect_ratio = aspectRatioForGroupFirstSource(firstSource);
	base.args = args;
	return base;
}
