import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WATERMARK_SVG_PATH = path.join(__dirname, "watermark.svg");

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
async function rasterizeWatermarkLogo(w, h) {
	// Always read from disk so edits to watermark.svg apply without restarting the server.
	const svgBuf = await readFile(WATERMARK_SVG_PATH);
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

	let meta;
	try {
		meta = await sharp(buffer, { failOn: "none" }).metadata();
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

	const mk = () =>
		sharp(buffer, { failOn: "none" })
			.rotate()
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
