/**
 * Shared YouTube video import helpers (composer paste+Enter + paste-link modal).
 */

/**
 * Normalize and accept youtube.com / youtu.be watch, shorts, and share URLs.
 * @param {string} value
 * @returns {string | null}
 */
export function extractYoutubeVideoUrl(value) {
	const raw = typeof value === 'string' ? value.trim() : '';
	if (!raw || raw.length > 2048) return null;
	let parsed;
	try {
		parsed = new URL(raw);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
	const host = (parsed.hostname || '').toLowerCase();
	const pathname = parsed.pathname || '';

	if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
		if (pathname === '/watch') {
			const v = parsed.searchParams.get('v');
			if (v && /^[a-zA-Z0-9_-]{6,}$/.test(v)) return parsed.toString();
		}
		const shortsMatch = pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,})\/?$/);
		if (shortsMatch?.[1]) return parsed.toString();
		return null;
	}

	if (host === 'youtu.be' || host === 'www.youtu.be') {
		const m = pathname.match(/^\/([a-zA-Z0-9_-]{6,})\/?$/);
		if (m?.[1]) return parsed.toString();
	}

	return null;
}

export function isYoutubeVideoUrl(value) {
	return Boolean(extractYoutubeVideoUrl(value));
}

/**
 * Prompt is only a YouTube URL (no other text) → safe to import on Enter/submit.
 * @param {string} text
 * @returns {string | null}
 */
export function extractSoloYoutubeImportUrl(text) {
	const raw = typeof text === 'string' ? text.trim() : '';
	if (!raw || /\s/.test(raw)) return null;
	return extractYoutubeVideoUrl(raw);
}

/**
 * @param {string} url
 * @returns {Promise<{ videoId: string, title: string, url: string, cover_url: string, existing_id: number|null }>}
 */
export async function previewYoutubeImportFromUrl(url) {
	const safeUrl = extractYoutubeVideoUrl(url);
	if (!safeUrl) {
		throw new Error('Paste a YouTube video link');
	}

	const res = await fetch(`/api/create/import-youtube/preview?url=${encodeURIComponent(safeUrl)}`, {
		method: 'GET',
		credentials: 'include',
	});
	let data = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}
	if (!res.ok) {
		const msg =
			(typeof data?.error === 'string' && data.error.trim()) ||
			(res.status === 401
				? 'Sign in to import a video.'
				: 'Could not check that YouTube link.');
		throw new Error(msg);
	}
	const videoId = typeof data?.videoId === 'string' ? data.videoId : '';
	if (!videoId) {
		throw new Error('Could not resolve that YouTube video.');
	}
	const existingRaw = Number(data?.existing_id);
	const coverRaw = typeof data?.cover_url === 'string' ? data.cover_url.trim() : '';
	let coverUrl = '';
	if (coverRaw) {
		try {
			const parsed = new URL(coverRaw);
			if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
				coverUrl = parsed.toString();
			}
		} catch {
			coverUrl = '';
		}
	}
	return {
		videoId,
		title: typeof data?.title === 'string' ? data.title : '',
		url: typeof data?.url === 'string' && data.url.trim() ? data.url.trim() : safeUrl,
		cover_url: coverUrl,
		existing_id: Number.isFinite(existingRaw) && existingRaw > 0 ? existingRaw : null,
	};
}

/**
 * @param {string} url
 * @param {{ creationToken?: string }} [options]
 * @returns {Promise<{ id: number, title?: string, warning?: object|null }>}
 */
export async function importYoutubeVideoFromUrl(url, options = {}) {
	const safeUrl = extractYoutubeVideoUrl(url);
	if (!safeUrl) {
		throw new Error('Paste a YouTube video link');
	}

	const creationToken =
		typeof options.creationToken === 'string' ? options.creationToken.trim() : '';

	const res = await fetch('/api/create/import-youtube', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({
			url: safeUrl,
			...(creationToken ? { creation_token: creationToken } : {}),
		}),
	});
	let data = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}
	if (!res.ok) {
		const msg =
			(typeof data?.error === 'string' && data.error.trim()) ||
			(res.status === 429
				? 'Too many imports — try again later.'
				: res.status === 401
					? 'Sign in to import a video.'
					: 'Could not import that video.');
		throw new Error(msg);
	}
	const id = Number(data?.id);
	if (!Number.isFinite(id) || id <= 0) {
		throw new Error('Import succeeded but no creation id was returned.');
	}
	return {
		id,
		title: typeof data?.title === 'string' ? data.title : '',
		warning: data?.warning || null,
	};
}
