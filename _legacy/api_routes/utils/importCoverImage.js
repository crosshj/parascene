import sharp from "sharp";

const COVER_FETCH_TIMEOUT_MS = 10_000;
const COVER_MAX_BYTES = 5 * 1024 * 1024;

function isPrivateOrLocalHostname(hostname) {
	const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
	if (!host) return true;
	if (host === "localhost" || host === "localhost.localdomain") return true;
	if (host === "0.0.0.0" || host === "::" || host === "::1") return true;
	if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
	if (host === "metadata.google.internal") return true;

	const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (ipv4) {
		const parts = ipv4.slice(1).map((n) => Number(n));
		if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
		const [a, b] = parts;
		if (a === 10 || a === 127 || a === 0) return true;
		if (a === 169 && b === 254) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 100 && b >= 64 && b <= 127) return true;
		return false;
	}

	if (host.includes(":")) {
		if (host === "::1") return true;
		if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
		return false;
	}

	return false;
}

function assertSafeCoverUrl(rawUrl) {
	let parsed;
	try {
		parsed = new URL(String(rawUrl || "").trim());
	} catch {
		const err = new Error("Invalid cover url");
		err.code = "INVALID_COVER_URL";
		throw err;
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		const err = new Error("Cover url must be http(s)");
		err.code = "INVALID_COVER_URL";
		throw err;
	}
	if (isPrivateOrLocalHostname(parsed.hostname)) {
		const err = new Error("Cover host not allowed");
		err.code = "COVER_HOST_BLOCKED";
		throw err;
	}
	return parsed.toString();
}

/**
 * Fetch a remote cover image and normalize to PNG via sharp.
 * @param {string} imageUrl
 * @param {{ userAgent?: string }} [options]
 * @returns {Promise<Buffer>}
 */
export async function fetchImportCoverImageBuffer(imageUrl, options = {}) {
	const safeUrl = assertSafeCoverUrl(imageUrl);
	const userAgent =
		typeof options.userAgent === "string" && options.userAgent.trim()
			? options.userAgent.trim()
			: "parascene-media-import";
	const response = await fetch(safeUrl, {
		method: "GET",
		redirect: "follow",
		headers: {
			Accept: "image/*,*/*;q=0.8",
			"User-Agent": userAgent,
		},
		signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS),
	});
	if (!response.ok) {
		const err = new Error(`Cover fetch failed (${response.status})`);
		err.code = "COVER_FETCH_FAILED";
		throw err;
	}

	if (typeof response.url === "string" && response.url.trim()) {
		assertSafeCoverUrl(response.url);
	}

	const contentType = String(response.headers.get("content-type") || "").toLowerCase();
	if (contentType && !contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
		const err = new Error("Cover response was not an image");
		err.code = "COVER_NOT_IMAGE";
		throw err;
	}

	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > COVER_MAX_BYTES) {
		const err = new Error("Cover image too large");
		err.code = "COVER_TOO_LARGE";
		throw err;
	}

	const ab = await response.arrayBuffer();
	if (!ab || ab.byteLength === 0) {
		const err = new Error("Empty cover image");
		err.code = "COVER_EMPTY";
		throw err;
	}
	if (ab.byteLength > COVER_MAX_BYTES) {
		const err = new Error("Cover image too large");
		err.code = "COVER_TOO_LARGE";
		throw err;
	}

	const raw = Buffer.from(ab);
	return await sharp(raw, { failOn: "none" }).png().toBuffer();
}
