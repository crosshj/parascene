import express from "express";

const SUNO_UUID_RE =
	/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const GENERIC_SUNO_OG_IMAGE_RE = /\/meta-preview\.(jpe?g|png|webp|gif)(\?|$)/i;

function isSunoUuid(value) {
	return typeof value === "string" && SUNO_UUID_RE.test(value);
}

function emptySunoTargetIds() {
	return { songId: "", slug: "", hookId: "", playlistId: "" };
}

/** Pathname only — used for pasted URLs and `/s/…` redirect Location. */
export function extractSunoTargetFromPathname(pathname) {
	const path = String(pathname || "").split("?")[0] || "";

	const songMatch = path.match(/^\/song\/([a-f0-9-]{36})\/?$/i);
	if (songMatch?.[1] && isSunoUuid(songMatch[1])) {
		return {
			kind: "song",
			...emptySunoTargetIds(),
			songId: songMatch[1].toLowerCase(),
		};
	}

	const embedMatch = path.match(/^\/embed\/([a-f0-9-]{36})\/?$/i);
	if (embedMatch?.[1] && isSunoUuid(embedMatch[1])) {
		return {
			kind: "song",
			...emptySunoTargetIds(),
			songId: embedMatch[1].toLowerCase(),
		};
	}

	const shareMatch = path.match(/^\/s\/([A-Za-z0-9]{8,32})\/?$/);
	if (shareMatch?.[1]) {
		return {
			kind: "share",
			...emptySunoTargetIds(),
			slug: shareMatch[1],
		};
	}

	const hookMatch = path.match(/^\/hook\/([a-f0-9-]{36})\/?$/i);
	if (hookMatch?.[1] && isSunoUuid(hookMatch[1])) {
		return {
			kind: "hook",
			...emptySunoTargetIds(),
			hookId: hookMatch[1].toLowerCase(),
		};
	}

	const handleHookMatch = path.match(
		/^\/@([^/]+)\/hook\/([a-f0-9-]{36})\/?$/i
	);
	if (handleHookMatch?.[2] && isSunoUuid(handleHookMatch[2])) {
		return {
			kind: "hook",
			...emptySunoTargetIds(),
			hookId: handleHookMatch[2].toLowerCase(),
		};
	}

	const playlistMatch = path.match(/^\/playlist\/([a-f0-9-]{36})\/?$/i);
	if (playlistMatch?.[1] && isSunoUuid(playlistMatch[1])) {
		return {
			kind: "playlist",
			...emptySunoTargetIds(),
			playlistId: playlistMatch[1].toLowerCase(),
		};
	}

	const handlePlaylistMatch = path.match(
		/^\/@([^/]+)\/playlist\/([a-f0-9-]{36})\/?$/i
	);
	if (handlePlaylistMatch?.[2] && isSunoUuid(handlePlaylistMatch[2])) {
		return {
			kind: "playlist",
			...emptySunoTargetIds(),
			playlistId: handlePlaylistMatch[2].toLowerCase(),
		};
	}

	return null;
}

export function extractSunoLinkTarget(url) {
	let parsed;
	try {
		parsed = new URL(String(url || ""));
	} catch {
		return null;
	}

	const host = parsed.hostname.toLowerCase();
	if (host !== "suno.com" && host !== "www.suno.com") return null;

	return extractSunoTargetFromPathname(parsed.pathname || "");
}

/** `/s/{slug}` may 307 to a song, hook, or playlist. */
export function extractSunoTargetFromLocation(location) {
	const raw = String(location ?? "").trim();
	if (!raw) return null;

	let pathname = "";
	try {
		const parsed = new URL(raw, "https://suno.com");
		pathname = parsed.pathname || "";
	} catch {
		pathname = raw.split("?")[0] || "";
	}

	const target = extractSunoTargetFromPathname(pathname);
	if (!target || target.kind === "share") return null;
	return target;
}

export function isSunoSongImportUrl(url) {
	const target = extractSunoLinkTarget(url);
	return Boolean(target && (target.kind === "song" || target.kind === "share"));
}

function normalizeUrl(raw) {
	const value = typeof raw === "string" ? raw.trim() : "";
	if (!value) return null;
	if (value.length > 2048) return null;
	if (!value.startsWith("https://") && !value.startsWith("http://")) return null;
	return value;
}

/** `/song/{uuid}` from a redirect Location (relative or absolute). */
export function extractSunoSongIdFromLocation(location) {
	const target = extractSunoTargetFromLocation(location);
	return target?.kind === "song" ? target.songId : "";
}

export function extractSunoSongIdFromHtml(html) {
	const raw = String(html ?? "");
	const m = raw.match(/\/song\/([a-f0-9-]{36})/i);
	if (!m?.[1] || !isSunoUuid(m[1])) return "";
	return m[1].toLowerCase();
}

function extractOgMetaContent(html, property) {
	const raw = String(html ?? "");
	const prop = String(property || "").trim();
	if (!prop) return "";
	const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(
		`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
		"i"
	);
	const reSwap = new RegExp(
		`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escaped}["']`,
		"i"
	);
	const m = raw.match(re) || raw.match(reSwap);
	return m?.[1] ? String(m[1]).trim() : "";
}

export function isGenericSunoOgImage(url) {
	const raw = String(url || "").trim();
	if (!raw) return false;
	try {
		const parsed = new URL(raw);
		const host = parsed.hostname.toLowerCase();
		const path = parsed.pathname || "";
		if (GENERIC_SUNO_OG_IMAGE_RE.test(path)) return true;
		if (host === "cdn-o.suno.com" && /meta-preview/i.test(path)) return true;
		return false;
	} catch {
		return GENERIC_SUNO_OG_IMAGE_RE.test(raw);
	}
}

function decodeHtmlEntities(value) {
	return String(value || "")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
}

/**
 * Best-effort card titles from Suno OG/document titles.
 * Playlist: "Name by @handle | Suno" → "Name | Suno playlist"
 * Hook: "Name | Suno" → "Name | Suno hook"
 */
export function formatSunoUnfurlTitle(rawTitle, kind) {
	let t = decodeHtmlEntities(String(rawTitle || "")).trim();
	if (!t) return "";

	if (kind === "playlist") {
		t = t.replace(/\s+\|\s+Suno(?:\s+Playlist)?\s*$/i, "");
		t = t.replace(/\s+by\s+@[A-Za-z0-9._-]+\s*$/i, "");
		t = t.trim();
		return t ? `${t} | Suno playlist` : "";
	}

	if (kind === "hook") {
		if (/\|\s*Suno\s+hook\s*$/i.test(t)) return t;
		if (/\s+\|\s+Suno\s*$/i.test(t)) {
			return t.replace(/\s+\|\s+Suno\s*$/i, " | Suno hook");
		}
		return `${t} | Suno hook`;
	}

	return t;
}

export function parseSunoPageMeta(html) {
	const raw = String(html ?? "");
	const songId = extractSunoSongIdFromHtml(raw);

	let title = decodeHtmlEntities(extractOgMetaContent(raw, "og:title"));
	let ogImage = extractOgMetaContent(raw, "og:image");
	if (isGenericSunoOgImage(ogImage)) ogImage = "";

	let creator = "";
	const docTitle = raw.match(/<title>([^<]*)<\/title>/i);
	const titleBody = docTitle?.[1]
		? decodeHtmlEntities(docTitle[1].trim())
		: "";
	const byMatch = titleBody.match(/^(.+?)\s+by\s+(.+?)\s+\|\s+Suno\s*$/i);
	if (byMatch) {
		if (!title) title = byMatch[1].trim();
		creator = byMatch[2].trim();
	} else if (!title) {
		const pipeMatch = titleBody.match(/^(.+?)\s+\|\s+Suno\s*$/i);
		if (pipeMatch) title = pipeMatch[1].trim();
		else if (titleBody) title = titleBody;
	}

	if (!songId && !title && !ogImage) return null;

	return { songId, title: title || "", creator, ogImage: ogImage || "" };
}

/** Share links 307 to `/song|hook|playlist/{uuid}?sh={slug}` — read Location. */
export async function resolveSunoShareTarget(slug) {
	const shareUrl = `https://suno.com/s/${encodeURIComponent(slug)}`;
	const upstream = await fetch(shareUrl, {
		method: "HEAD",
		redirect: "manual",
		headers: {
			Accept: "text/html",
			"User-Agent": "parascene-suno-resolve",
		},
	});

	const fromRedirect = extractSunoTargetFromLocation(
		upstream.headers.get("location") || ""
	);
	if (fromRedirect) return fromRedirect;

	const bodyRes = await fetch(shareUrl, {
		method: "GET",
		redirect: "manual",
		headers: {
			Accept: "text/html",
			"User-Agent": "parascene-suno-resolve",
		},
	});
	return extractSunoTargetFromLocation(bodyRes.headers.get("location") || "");
}

/** @deprecated song-only; share slugs may now resolve to hooks/playlists. */
export async function resolveSunoShareSlug(slug) {
	const target = await resolveSunoShareTarget(slug);
	return target?.kind === "song" ? target.songId : "";
}

async function fetchSunoPageMeta(fetchUrl) {
	const upstream = await fetch(fetchUrl, {
		method: "GET",
		headers: {
			Accept: "text/html",
			"User-Agent": "parascene-suno-resolve",
		},
	});

	if (!upstream.ok) return null;
	const html = await upstream.text();
	return parseSunoPageMeta(html);
}

function emptyResolvedIds() {
	return { songId: "", hookId: "", playlistId: "" };
}

/**
 * Resolve a permissive Suno song/share/embed/hook/playlist URL to kind + page meta.
 * @param {string} rawUrl
 * @returns {Promise<{
 *   kind: 'song'|'hook'|'playlist',
 *   songId: string,
 *   hookId: string,
 *   playlistId: string,
 *   title: string,
 *   creator: string,
 *   ogImage: string,
 *   url: string,
 *   embedUrl: string,
 * }>}
 */
export async function resolveSunoFromUrl(rawUrl) {
	const url = normalizeUrl(rawUrl);
	if (!url) {
		const err = new Error("Missing url");
		err.code = "INVALID_URL";
		err.status = 400;
		throw err;
	}

	const target = extractSunoLinkTarget(url);
	if (!target) {
		const err = new Error("Invalid Suno url");
		err.code = "INVALID_SUNO_URL";
		err.status = 400;
		throw err;
	}

	let resolvedTarget = target;
	if (resolvedTarget.kind === "share" && resolvedTarget.slug) {
		resolvedTarget = await resolveSunoShareTarget(resolvedTarget.slug);
		if (!resolvedTarget) {
			const err = new Error("Could not resolve Suno link");
			err.code = "RESOLVE_FAILED";
			err.status = 502;
			throw err;
		}
	}

	if (resolvedTarget.kind === "hook") {
		const hookId = resolvedTarget.hookId;
		const canonicalUrl = `https://suno.com/hook/${encodeURIComponent(hookId)}`;
		const meta = await fetchSunoPageMeta(canonicalUrl);
		return {
			kind: "hook",
			...emptyResolvedIds(),
			hookId,
			title: formatSunoUnfurlTitle(meta?.title || "", "hook"),
			creator: meta?.creator || "",
			ogImage: meta?.ogImage || "",
			url: canonicalUrl,
			embedUrl: "",
		};
	}

	if (resolvedTarget.kind === "playlist") {
		const playlistId = resolvedTarget.playlistId;
		const canonicalUrl = `https://suno.com/playlist/${encodeURIComponent(playlistId)}`;
		const meta = await fetchSunoPageMeta(canonicalUrl);
		return {
			kind: "playlist",
			...emptyResolvedIds(),
			playlistId,
			title: formatSunoUnfurlTitle(meta?.title || "", "playlist"),
			creator: meta?.creator || "",
			ogImage: meta?.ogImage || "",
			url: canonicalUrl,
			embedUrl: "",
		};
	}

	const songId = resolvedTarget.songId;
	if (!songId) {
		const err = new Error("Could not resolve Suno song");
		err.code = "RESOLVE_FAILED";
		err.status = 502;
		throw err;
	}

	const canonicalUrl = `https://suno.com/song/${encodeURIComponent(songId)}`;
	const meta = await fetchSunoPageMeta(canonicalUrl);
	return {
		kind: "song",
		...emptyResolvedIds(),
		songId,
		title: meta?.title || "",
		creator: meta?.creator || "",
		ogImage: meta?.ogImage || "",
		url: canonicalUrl,
		embedUrl: `https://suno.com/embed/${encodeURIComponent(songId)}`,
	};
}

/**
 * Resolve a permissive Suno song/share/embed URL to song id + page meta.
 * @param {string} rawUrl
 * @returns {Promise<{ songId: string, title: string, creator: string, ogImage: string, url: string, embedUrl: string }>}
 */
export async function resolveSunoSongFromUrl(rawUrl) {
	const resolved = await resolveSunoFromUrl(rawUrl);
	if (resolved.kind !== "song" || !resolved.songId) {
		const err = new Error("Invalid Suno url");
		err.code = "INVALID_SUNO_URL";
		err.status = 400;
		throw err;
	}
	return {
		songId: resolved.songId,
		title: resolved.title,
		creator: resolved.creator,
		ogImage: resolved.ogImage,
		url: resolved.url,
		embedUrl: resolved.embedUrl,
	};
}

export default function createSunoRoutes() {
	const router = express.Router();

	router.get("/api/suno/resolve", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const url = normalizeUrl(req.query?.url);
		if (!url) {
			return res.status(400).json({ error: "Missing url" });
		}

		res.setHeader(
			"Cache-Control",
			"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"
		);

		try {
			const resolved = await resolveSunoFromUrl(url);
			return res.json({
				kind: resolved.kind,
				songId: resolved.songId,
				hookId: resolved.hookId,
				playlistId: resolved.playlistId,
				title: resolved.title,
				creator: resolved.creator,
				ogImage: resolved.ogImage,
				url: resolved.url,
			});
		} catch (err) {
			const status = Number(err?.status) || 502;
			const message =
				typeof err?.message === "string" && err.message.trim()
					? err.message.trim()
					: "Suno resolve fetch failed";
			return res.status(status).json({ error: message });
		}
	});

	return router;
}
