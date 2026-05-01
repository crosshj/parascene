import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WATERMARK_SVG_PATH = path.join(__dirname, "watermark.svg");
const LIGHT_WATERMARK_FILL = "#ffffff";
const DARK_WATERMARK_FILL = "#000000";
const LIGHT_BG_LUMINANCE_THRESHOLD = 0.62;

/** viewBox from watermark.svg — used for aspect ratio when scaling */
const WATERMARK_VIEW_W = 185;
const WATERMARK_VIEW_H = 40;

/**
 * Rasterize logo SVG sized for bottom-right placement on an image of w×h.
 *
 * @param {number} w
 * @param {number} h
 * @returns {Promise<{ buffer: Buffer, width: number, height: number }>}
 */
async function rasterizeWatermarkLogo(w, h, opts = {}) {
	const { darkVariant = false } = opts;
	// Always read from disk so edits to watermark.svg apply without restarting the server.
	const svgRaw = await readFile(WATERMARK_SVG_PATH, "utf8");
	const fillColor = darkVariant ? DARK_WATERMARK_FILL : LIGHT_WATERMARK_FILL;
	const svgText = svgRaw.replace(/fill="#[0-9a-fA-F]{3,8}"/u, `fill="${fillColor}"`);
	const svgBuf = Buffer.from(svgText, "utf8");
	const aspect = WATERMARK_VIEW_W / WATERMARK_VIEW_H;
	const minSide = Math.min(w, h);
	const pad = Math.max(10, Math.round(minSide * 0.018));

	let targetW = Math.min(Math.round(minSide * 0.42), Math.round(w * 0.45));
	targetW = Math.max(24, Math.min(targetW, w - 2 * pad));
	let targetH = Math.round(targetW / aspect);
	if (targetH > h - 2 * pad) {
		targetH = Math.max(16, h - 2 * pad);
		targetW = Math.round(targetH * aspect);
	}

	const raster = await sharp(svgBuf, { density: 300 })
		.resize(targetW, targetH, { fit: "inside" })
		.png()
		.ensureAlpha()
		.toBuffer();

	const meta = await sharp(raster).metadata();
	const lw = Math.max(1, meta.width || targetW);
	const lh = Math.max(1, meta.height || targetH);

	return { buffer: raster, width: lw, height: lh };
}

/**
 * Compute average luminance in the region where the watermark will be placed.
 *
 * @param {Buffer} baseBuffer
 * @param {number} left
 * @param {number} top
 * @param {number} regionW
 * @param {number} regionH
 * @returns {Promise<number | null>}
 */
async function samplePlacementLuminance(baseBuffer, left, top, regionW, regionH) {
	try {
		const stats = await sharp(baseBuffer, { failOn: "none" })
			.extract({
				left: Math.max(0, Math.floor(left)),
				top: Math.max(0, Math.floor(top)),
				width: Math.max(1, Math.floor(regionW)),
				height: Math.max(1, Math.floor(regionH))
			})
			.stats();
		const channels = Array.isArray(stats.channels) ? stats.channels : [];
		const r = (channels[0]?.mean ?? 0) / 255;
		const g = (channels[1]?.mean ?? 0) / 255;
		const b = (channels[2]?.mean ?? 0) / 255;
		return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
	} catch {
		return null;
	}
}

/**
 * Bottom-right logo from `watermark.svg` for Vynly share exports.
 * Returns original buffer on sharp failure (caller still uploads).
 *
 * @param {Buffer} buffer
 * @returns {Promise<{ buffer: Buffer, contentType: string | null, filenameSuffix: string | null }>}
 */
export async function applyVynlyShareWatermark(buffer) {
	if (!buffer || !Buffer.isBuffer(buffer)) {
		return { buffer, contentType: null, filenameSuffix: null };
	}

	let orientedBuffer;
	try {
		orientedBuffer = await sharp(buffer, { failOn: "none" }).rotate().toBuffer();
	} catch {
		return { buffer, contentType: null, filenameSuffix: null };
	}

	let meta;
	try {
		meta = await sharp(orientedBuffer, { failOn: "none" }).metadata();
	} catch {
		return { buffer, contentType: null, filenameSuffix: null };
	}

	const w = Math.max(1, meta.width || 1);
	const h = Math.max(1, meta.height || 1);
	const maxBytes = 4 * 1024 * 1024;

	let logo;
	try {
		logo = await rasterizeWatermarkLogo(w, h);
	} catch {
		return { buffer, contentType: null, filenameSuffix: null };
	}

	const pad = Math.max(10, Math.round(Math.min(w, h) * 0.018));
	const left = Math.max(0, w - logo.width - pad);
	const top = Math.max(0, h - logo.height - pad);

	const luminance = await samplePlacementLuminance(orientedBuffer, left, top, logo.width, logo.height);
	if (typeof luminance === "number" && luminance >= LIGHT_BG_LUMINANCE_THRESHOLD) {
		try {
			logo = await rasterizeWatermarkLogo(w, h, { darkVariant: true });
		} catch {
			// fall back to light variant
		}
	}

	const mk = () =>
		sharp(orientedBuffer, { failOn: "none" })
			.composite([{ input: logo.buffer, left, top, blend: "over" }]);

	try {
		let out = await mk().png({ compressionLevel: 9, effort: 4 }).toBuffer();
		let contentType = "image/png";
		let filenameSuffix = ".png";

		if (out.length > maxBytes) {
			let q = 88;
			while (q >= 60) {
				out = await mk().jpeg({ quality: q, mozjpeg: true }).toBuffer();
				contentType = "image/jpeg";
				filenameSuffix = ".jpg";
				if (out.length <= maxBytes) break;
				q -= 8;
			}
		}

		if (out.length > maxBytes) {
			const e = new Error(
				"Watermarked image exceeds the 4 MB Vynly upload limit. Use a smaller source image."
			);
			e.status = 413;
			throw e;
		}

		return { buffer: out, contentType, filenameSuffix };
	} catch (e) {
		if (e && typeof e === "object" && "status" in e && /** @type {{ status?: number }} */ (e).status === 413) {
			throw e;
		}
		return { buffer, contentType: null, filenameSuffix: null };
	}
}
