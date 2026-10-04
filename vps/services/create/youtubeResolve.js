/**
 * YouTube URL resolve helpers (shared by oembed route + import).
 */

export function extractYoutubeVideoId(url) {
	let parsed;
	try {
		parsed = new URL(String(url || ""));
	} catch {
		return null;
	}

	const host = parsed.hostname.toLowerCase();
	const pathname = parsed.pathname || "";

	if (host === "www.youtube.com" || host === "youtube.com" || host === "m.youtube.com") {
		if (pathname === "/watch") {
			const v = parsed.searchParams.get("v");
			return v && /^[a-zA-Z0-9_-]{6,}$/.test(v) ? v : null;
		}

		const shortsMatch = pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,})/);
		if (shortsMatch) return shortsMatch[1];
	}

	if (host === "youtu.be" || host === "www.youtu.be") {
		const m = pathname.match(/^\/([a-zA-Z0-9_-]{6,})/);
		if (m) return m[1];
	}

	return null;
}

export function normalizeYoutubeUrl(raw) {
	const value = typeof raw === "string" ? raw.trim() : "";
	if (!value) return null;
	if (value.length > 2048) return null;
	if (!value.startsWith("https://") && !value.startsWith("http://")) return null;
	if (!extractYoutubeVideoId(value)) return null;
	return value;
}

/** True for youtube.com/shorts/… links (product-vertical). */
export function isYoutubeShortsUrl(rawUrl) {
	const value = typeof rawUrl === "string" ? rawUrl.trim() : "";
	if (!value) return false;
	try {
		const parsed = new URL(value);
		const host = parsed.hostname.toLowerCase();
		if (host !== "youtube.com" && host !== "www.youtube.com" && host !== "m.youtube.com") {
			return false;
		}
		return /^\/shorts\/[a-zA-Z0-9_-]{6,}/i.test(parsed.pathname || "");
	} catch {
		return false;
	}
}

export function extractYoutubeCreator({ authorUrl, authorName }) {
	let handle = "";
	try {
		const parsed = new URL(String(authorUrl || ""));
		const path = String(parsed.pathname || "");
		const m = path.match(/^\/@([A-Za-z0-9._-]{2,})/);
		if (m) handle = `@${m[1]}`;
	} catch {
		// ignore
	}

	const name = typeof authorName === "string" ? authorName.trim() : "";
	return handle || name || "";
}

function youtubeThumbnailCandidates(videoId) {
	const id = String(videoId || "").trim();
	if (!id) return [];
	const enc = encodeURIComponent(id);
	// Prefer higher-res frames first. oEmbed usually returns hqdefault (~480×360),
	// which is too soft after Shorts 9:16 crop — keep it as a last-resort only.
	return [
		`https://i.ytimg.com/vi/${enc}/maxresdefault.jpg`,
		`https://i.ytimg.com/vi/${enc}/hq720.jpg`,
		`https://i.ytimg.com/vi/${enc}/sddefault.jpg`,
		`https://i.ytimg.com/vi/${enc}/hqdefault.jpg`,
	];
}

function youtubeEmbedUrl(videoId) {
	const id = String(videoId || "").trim();
	if (!id) return "";
	return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0`;
}

/**
 * Resolve a YouTube watch/shorts/share URL via oEmbed (+ thumbnail fallback).
 * @param {string} rawUrl
 * @returns {Promise<{ videoId: string, title: string, creator: string, thumbnailUrl: string, thumbnailCandidates: string[], url: string, embedUrl: string, isShorts: boolean }>}
 */
export async function resolveYoutubeVideoFromUrl(rawUrl) {
	const url = normalizeYoutubeUrl(rawUrl);
	if (!url) {
		const err = new Error("Paste a YouTube video link");
		err.status = 400;
		err.code = "INVALID_YOUTUBE_URL";
		throw err;
	}

	const videoId = extractYoutubeVideoId(url);
	if (!videoId) {
		const err = new Error("Paste a YouTube video link");
		err.status = 400;
		err.code = "INVALID_YOUTUBE_URL";
		throw err;
	}

	const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
	let title = "";
	let creator = "";
	let thumbnailUrl = "";

	try {
		const upstream = await fetch(oembedUrl, {
			method: "GET",
			headers: {
				Accept: "application/json",
				"User-Agent": "parascene-youtube-import",
			},
			signal: AbortSignal.timeout(10_000),
		});
		if (upstream.ok) {
			const data = await upstream.json().catch(() => null);
			title = typeof data?.title === "string" ? data.title.trim() : "";
			creator = extractYoutubeCreator({
				authorUrl: data?.author_url,
				authorName: data?.author_name,
			});
			thumbnailUrl =
				typeof data?.thumbnail_url === "string" ? data.thumbnail_url.trim() : "";
		}
	} catch {
		// Fall through to id-based thumbnail; title stays empty.
	}

	// High-res id-based frames first; oEmbed thumb (often hqdefault) only as fallback.
	const thumbnailCandidates = youtubeThumbnailCandidates(videoId);
	if (thumbnailUrl && !thumbnailCandidates.includes(thumbnailUrl)) {
		thumbnailCandidates.push(thumbnailUrl);
	}

	return {
		videoId,
		title,
		creator,
		thumbnailUrl: thumbnailCandidates[0] || thumbnailUrl || "",
		thumbnailCandidates,
		url,
		embedUrl: youtubeEmbedUrl(videoId),
		isShorts: isYoutubeShortsUrl(url),
	};
}
