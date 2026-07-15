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
export const FIT_THUMB_JPEG_QUALITY = 85;

/**
 * Storage key for native-aspect fit thumb in the thumbnail bucket.
 * Square thumb keeps the full-image filename; fit uses `{base}_fit.jpg`.
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
 * Build a native-aspect JPEG thumb (long edge FIT_THUMB_LONG_EDGE).
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
	return pipeline.jpeg({ quality: FIT_THUMB_JPEG_QUALITY, mozjpeg: true }).toBuffer();
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
