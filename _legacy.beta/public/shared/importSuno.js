/**
 * Shared Suno song import helpers (composer paste+Enter + paste-link modal).
 */

const SUNO_UUID_RE =
	/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/**
 * True when url is a permissive Suno song / embed / share link.
 * @param {string} value
 * @returns {boolean}
 */
export function isSunoSongUrl(value) {
	return Boolean(extractSunoSongUrl(value));
}

/**
 * Normalize and accept suno.com song/share/embed URLs only.
 * @param {string} value
 * @returns {string | null} trimmed url or null
 */
export function extractSunoSongUrl(value) {
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
	if (host !== 'suno.com' && host !== 'www.suno.com') return null;

	const pathname = parsed.pathname || '';
	const songMatch = pathname.match(/^\/song\/([a-f0-9-]{36})\/?$/i);
	if (songMatch?.[1] && SUNO_UUID_RE.test(songMatch[1])) return parsed.toString();

	const embedMatch = pathname.match(/^\/embed\/([a-f0-9-]{36})\/?$/i);
	if (embedMatch?.[1] && SUNO_UUID_RE.test(embedMatch[1])) return parsed.toString();

	const shareMatch = pathname.match(/^\/s\/([A-Za-z0-9]{8,32})\/?$/);
	if (shareMatch?.[1]) return parsed.toString();

	return null;
}

/**
 * Prompt is only a Suno song URL (no other text) → safe to import on Enter/submit.
 * @param {string} text
 * @returns {string | null}
 */
export function extractSoloSunoImportUrl(text) {
	const raw = typeof text === 'string' ? text.trim() : '';
	if (!raw || /\s/.test(raw)) return null;
	return extractSunoSongUrl(raw);
}

/**
 * Resolve + check for an existing import (no create).
 * @param {string} url
 * @returns {Promise<{ songId: string, title: string, url: string, cover_url: string, existing_id: number|null }>}
 */
export async function previewSunoImportFromUrl(url) {
	const safeUrl = extractSunoSongUrl(url);
	if (!safeUrl) {
		throw new Error('Paste a suno.com song link');
	}

	const res = await fetch(`/api/create/import-suno/preview?url=${encodeURIComponent(safeUrl)}`, {
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
				? 'Sign in to import a song.'
				: 'Could not check that Suno link.');
		throw new Error(msg);
	}
	const songId = typeof data?.songId === 'string' ? data.songId : '';
	if (!songId) {
		throw new Error('Could not resolve that Suno song.');
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
		songId,
		title: typeof data?.title === 'string' ? data.title : '',
		url: typeof data?.url === 'string' && data.url.trim() ? data.url.trim() : safeUrl,
		cover_url: coverUrl,
		existing_id: Number.isFinite(existingRaw) && existingRaw > 0 ? existingRaw : null,
	};
}

/**
 * POST /api/create/import-suno
 * @param {string} url
 * @param {{ creationToken?: string }} [options]
 * @returns {Promise<{ id: number, title?: string, warning?: object|null }>}
 */
export async function importSunoSongFromUrl(url, options = {}) {
	const safeUrl = extractSunoSongUrl(url);
	if (!safeUrl) {
		throw new Error('Paste a suno.com song link');
	}

	const creationToken =
		typeof options.creationToken === 'string' ? options.creationToken.trim() : '';

	const res = await fetch('/api/create/import-suno', {
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
					? 'Sign in to import a song.'
					: 'Could not import that song.');
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
