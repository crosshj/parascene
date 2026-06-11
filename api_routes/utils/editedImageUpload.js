import sharp from "sharp";
import {
	dimensionsForAspectRatioLongEdge,
	parseAspectRatioString,
} from "../../public/shared/aspectRatio.js";

const EDITED_UPLOAD_LONG_EDGE = 1024;
const LETTERBOX_BACKGROUND = { r: 24, g: 24, b: 32, alpha: 1 };

/**
 * Letterbox a buffer into aspect_ratio at long edge (no crop — preserves all pixels).
 * @param {Buffer} buffer
 * @param {unknown} aspectRatioRaw
 * @param {number} [longEdge]
 * @returns {Promise<Buffer>}
 */
export async function letterboxImageBuffer(buffer, aspectRatioRaw, longEdge = EDITED_UPLOAD_LONG_EDGE) {
	const parsed = parseAspectRatioString(aspectRatioRaw);
	if (!parsed) {
		return sharp(buffer).png().toBuffer();
	}
	const { width: targetW, height: targetH } = dimensionsForAspectRatioLongEdge(
		aspectRatioRaw,
		longEdge
	);
	const meta = await sharp(buffer).metadata();
	const width = Number(meta.width);
	const height = Number(meta.height);
	if (
		Number.isFinite(width) &&
		width > 0 &&
		Number.isFinite(height) &&
		height > 0 &&
		width === targetW &&
		height === targetH
	) {
		return sharp(buffer).png().toBuffer();
	}
	return sharp(buffer)
		.resize(targetW, targetH, {
			fit: "contain",
			background: LETTERBOX_BACKGROUND,
		})
		.png()
		.toBuffer();
}

/**
 * Normalize a buffer for the `edited` upload path (create / mutate inputs).
 * When aspect_ratio is set, resize to that ratio (long edge 1024). Otherwise legacy 1024² cover.
 * @param {Buffer} buffer
 * @param {unknown} [aspectRatioRaw]
 * @returns {Promise<Buffer>}
 */
export async function normalizeEditedUploadBuffer(buffer, aspectRatioRaw) {
	const meta = await sharp(buffer).metadata();
	const width = Number(meta.width);
	const height = Number(meta.height);
	const parsed = parseAspectRatioString(aspectRatioRaw);

	if (parsed) {
		const { width: targetW, height: targetH } = dimensionsForAspectRatioLongEdge(
			aspectRatioRaw,
			EDITED_UPLOAD_LONG_EDGE
		);
		if (
			Number.isFinite(width) &&
			width > 0 &&
			Number.isFinite(height) &&
			height > 0 &&
			(width !== targetW || height !== targetH)
		) {
			return sharp(buffer)
				.resize(targetW, targetH, { fit: "cover", position: "entropy" })
				.png()
				.toBuffer();
		}
		return sharp(buffer).png().toBuffer();
	}

	if (
		Number.isFinite(width) &&
		width > 0 &&
		Number.isFinite(height) &&
		height > 0 &&
		(width !== EDITED_UPLOAD_LONG_EDGE || height !== EDITED_UPLOAD_LONG_EDGE)
	) {
		return sharp(buffer)
			.resize(EDITED_UPLOAD_LONG_EDGE, EDITED_UPLOAD_LONG_EDGE, {
				fit: "cover",
				position: "entropy",
			})
			.png()
			.toBuffer();
	}

	return sharp(buffer).png().toBuffer();
}

/**
 * @param {import('express').Request} req
 * @returns {string | null}
 */
export function readUploadAspectRatioHeader(req) {
	const raw = req.headers["x-upload-aspect-ratio"];
	if (raw == null) return null;
	const key = String(raw).trim();
	if (!key) return null;
	return parseAspectRatioString(key) ? key : null;
}
