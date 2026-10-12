import sharp from "sharp";
import {
	dimensionsForAspectRatioLongEdge,
	dimensionsMatchAspectRatio,
	parseAspectRatioString,
} from "../../public/shared/aspectRatio.js";
import { getShareBaseUrl } from "./url.js";
import { letterboxImageBuffer } from "./editedImageUpload.js";

function safeKeySegment(segment) {
	return String(segment || "")
		.replace(/[^a-z0-9._-]/gi, "_")
		.replace(/_+/g, "_")
		.slice(0, 80);
}

function buildGenericUrl(key) {
	const segments = String(key || "")
		.split("/")
		.filter(Boolean)
		.map((seg) => encodeURIComponent(seg));
	return `/api/images/generic/${segments.join("/")}`;
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function toAbsoluteProviderFetchUrl(raw) {
	const value = String(raw || "").trim();
	if (!value) return "";
	if (/^https?:\/\//i.test(value)) return value;
	const base = getShareBaseUrl().replace(/\/$/, "");
	const path = value.startsWith("/") ? value : `/${value}`;
	return `${base}${path}`;
}

/**
 * @param {Record<string, unknown>} args
 * @returns {{ key: string, index: number | null, url: string }[]}
 */
export function listProviderInputImageRefs(args) {
	if (!args || typeof args !== "object") return [];
	const refs = [];
	for (const key of ["image_url", "image", "source_image_url"]) {
		const url = typeof args[key] === "string" ? args[key].trim() : "";
		if (url) refs.push({ key, index: null, url });
	}
	const inputImages = args.input_images;
	if (Array.isArray(inputImages)) {
		inputImages.forEach((entry, index) => {
			const url = typeof entry === "string" ? entry.trim() : "";
			if (url) refs.push({ key: "input_images", index, url });
		});
	}
	return refs;
}

/**
 * Fetch source bytes for provider input normalization.
 * @param {string} imageUrl
 * @param {number} [timeoutMs]
 * @returns {Promise<Buffer>}
 */
export async function fetchProviderInputImageBuffer(imageUrl, timeoutMs = 50_000) {
	const absolute = toAbsoluteProviderFetchUrl(imageUrl);
	if (!absolute) {
		const err = new Error("Missing image URL for aspect normalization");
		err.code = "MISSING_IMAGE_URL";
		throw err;
	}
	const response = await fetch(absolute, {
		method: "GET",
		headers: { Accept: "image/*" },
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		const err = new Error(`Failed to fetch input image: ${response.status} ${response.statusText}`);
		err.code = "SOURCE_IMAGE_FETCH_FAILED";
		throw err;
	}
	return Buffer.from(await response.arrayBuffer());
}

/**
 * When aspect_ratio is set, re-encode input image URLs to match (letterbox, long edge 1024).
 * Honors user-requested output ratio even when the uploaded file was square or another shape.
 *
 * @param {{
 *   args: Record<string, unknown>,
 *   storage: { uploadGenericImage?: (buf: Buffer, key: string, opts?: { contentType?: string }) => Promise<string> },
 *   userId: number,
 *   fetchBuffer?: (url: string) => Promise<Buffer>,
 * }} params
 * @returns {Promise<Record<string, unknown>>}
 */
export async function normalizeProviderArgsForAspectRatio({
	args,
	storage,
	userId,
	fetchBuffer = fetchProviderInputImageBuffer,
}) {
	if (!args || typeof args !== "object") return args || {};
	const aspectRaw = args.aspect_ratio;
	if (!parseAspectRatioString(aspectRaw)) return { ...args };
	if (!storage?.uploadGenericImage) return { ...args };

	const next = { ...args };
	if (Array.isArray(next.input_images)) {
		next.input_images = [...next.input_images];
	}

	const refs = listProviderInputImageRefs(next);
	if (refs.length === 0) return next;

	const { width: targetW, height: targetH } = dimensionsForAspectRatioLongEdge(aspectRaw, 1024);
	const userPart = safeKeySegment(String(userId));

	for (const ref of refs) {
		let buffer;
		try {
			buffer = await fetchBuffer(ref.url);
		} catch (err) {
			console.warn("[Creation] aspect normalize: could not fetch input image", {
				url: ref.url,
				message: err?.message || String(err),
			});
			continue;
		}

		let width = 0;
		let height = 0;
		try {
			const meta = await sharp(buffer).metadata();
			width = Number(meta.width);
			height = Number(meta.height);
		} catch {
			continue;
		}

		const matches = dimensionsMatchAspectRatio(width, height, aspectRaw);
		if (matches === true) {
			if (width === targetW && height === targetH) continue;
		}

		let normalized;
		try {
			normalized = await letterboxImageBuffer(buffer, aspectRaw);
		} catch (err) {
			console.warn("[Creation] aspect normalize: resize failed", {
				url: ref.url,
				message: err?.message || String(err),
			});
			continue;
		}

		const timestamp = Date.now();
		const rand = Math.random().toString(36).slice(2, 9);
		const key = `edited/${userPart}/${timestamp}_${rand}.png`;
		try {
			await storage.uploadGenericImage(normalized, key, { contentType: "image/png" });
		} catch (err) {
			console.warn("[Creation] aspect normalize: upload failed", {
				message: err?.message || String(err),
			});
			continue;
		}

		const newUrl = toAbsoluteProviderFetchUrl(buildGenericUrl(key));
		if (ref.key === "input_images" && ref.index != null && Array.isArray(next.input_images)) {
			next.input_images[ref.index] = newUrl;
		} else {
			next[ref.key] = newUrl;
		}
	}

	return next;
}
