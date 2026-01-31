/**
 * Escapes text for safe HTML insertion.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function splitUrlTrailingPunctuation(rawUrl) {
	let url = String(rawUrl || '');
	let trailing = '';

	// Common sentence punctuation that often attaches to the end of URLs.
	// We trim a few chars at most to avoid over-aggressive stripping.
	const stripChars = '.,!?:;';
	let safety = 0;
	while (url && safety < 8) {
		const last = url[url.length - 1];
		if (stripChars.includes(last)) {
			trailing = last + trailing;
			url = url.slice(0, -1);
			safety++;
			continue;
		}
		// Sometimes URLs are wrapped like "(https://...)".
		if ((last === ')' || last === ']' || last === '}') && url.length > 1) {
			trailing = last + trailing;
			url = url.slice(0, -1);
			safety++;
			continue;
		}
		break;
	}

	return { url, trailing };
}

function extractCreationId(url) {
	const m = String(url || '').match(/\/creations\/(\d+)\/?/i);
	if (!m) return null;
	const id = Number(m[1]);
	return Number.isFinite(id) && id > 0 ? String(id) : null;
}

function extractYoutubeVideoId(url) {
	let parsed;
	try {
		parsed = new URL(String(url || ''));
	} catch {
		return null;
	}

	const host = parsed.hostname.toLowerCase();
	const pathname = parsed.pathname || '';

	// youtube.com/watch?v=VIDEO_ID
	if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') {
		if (pathname === '/watch') {
			const v = parsed.searchParams.get('v');
			return v && /^[a-zA-Z0-9_-]{6,}$/.test(v) ? v : null;
		}

		// youtube.com/shorts/VIDEO_ID
		const shortsMatch = pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,})/);
		if (shortsMatch) return shortsMatch[1];
	}

	// youtu.be/VIDEO_ID
	if (host === 'youtu.be' || host === 'www.youtu.be') {
		const m = pathname.match(/^\/([a-zA-Z0-9_-]{6,})/);
		if (m) return m[1];
	}

	return null;
}

/**
 * Matches full URLs that point to a creation page (e.g. https://parascene.crosshj.com/creations/219).
 * Captures the creation ID for the replacement path.
 */
const CREATION_URL_RE = /https?:\/\/[^\s"'<>]+\/creations\/(\d+)\/?/g;

/**
 * Turns plain text into HTML that is safe to insert and converts full creation URLs
 * (e.g. https://parascene.crosshj.com/creations/219) into relative links that display
 * as /creations/219 and navigate to that creation page.
 *
 * Also detects YouTube URLs and converts them into links with a consistent label:
 * - Initial label is `YouTube: {videoId}`
 * - Call `hydrateYoutubeLinkTitles(rootEl)` to asynchronously replace the link text with `YouTube: {title}`
 *
 * Use when rendering user content such as image descriptions or comments.
 *
 * @param {string} text - Raw user text (may contain URLs and special characters)
 * @returns {string} - HTML-safe string with creation URLs as <a href="/creations/123">/creations/123</a>
 */
export function textWithCreationLinks(text) {
	const raw = String(text ?? '');
	if (!raw) return '';

	const urlRe = /https?:\/\/[^\s"'<>]+/g;
	let out = '';

	let lastIndex = 0;
	let match;
	while ((match = urlRe.exec(raw)) !== null) {
		const start = match.index;
		const rawUrl = match[0];

		out += escapeHtml(raw.slice(lastIndex, start));

		const { url, trailing } = splitUrlTrailingPunctuation(rawUrl);
		const creationId = extractCreationId(url);
		if (creationId) {
			const path = `/creations/${creationId}`;
			out += `<a href="${path}" class="user-link creation-link">${path}</a>`;
			out += escapeHtml(trailing);
			lastIndex = start + rawUrl.length;
			continue;
		}

		const videoId = extractYoutubeVideoId(url);
		if (videoId) {
			const safeUrl = escapeHtml(url);
			out += `<a href="${safeUrl}" class="user-link creation-link" target="_blank" rel="noopener noreferrer" data-youtube-url="${safeUrl}" data-youtube-video-id="${escapeHtml(videoId)}">YouTube: ${escapeHtml(videoId)}</a>`;
			out += escapeHtml(trailing);
			lastIndex = start + rawUrl.length;
			continue;
		}

		// Not a recognized URL type: keep as plain text (do not linkify).
		out += escapeHtml(rawUrl);
		lastIndex = start + rawUrl.length;
	}

	out += escapeHtml(raw.slice(lastIndex));
	return out;
}

const YT_TITLE_CACHE_PREFIX = 'ps_yt_title_v1:';
const YT_TITLE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const ytInFlight = new Map();

function getCachedYoutubeTitle(videoId) {
	try {
		const key = `${YT_TITLE_CACHE_PREFIX}${videoId}`;
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed.title !== 'string' || typeof parsed.savedAt !== 'number') return null;
		if (Date.now() - parsed.savedAt > YT_TITLE_TTL_MS) return null;
		const title = parsed.title.trim();
		return title ? title : null;
	} catch {
		return null;
	}
}

function setCachedYoutubeTitle(videoId, title) {
	try {
		const key = `${YT_TITLE_CACHE_PREFIX}${videoId}`;
		localStorage.setItem(key, JSON.stringify({ title, savedAt: Date.now() }));
	} catch {
		// Ignore storage errors (quota, privacy mode, etc.)
	}
}

export function hydrateYoutubeLinkTitles(rootEl) {
	const root = rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;

	const links = Array.from(root.querySelectorAll('a[data-youtube-video-id][data-youtube-url]'));
	for (const a of links) {
		if (!(a instanceof HTMLAnchorElement)) continue;
		if (a.dataset.youtubeTitleHydrated === 'true') continue;

		const videoId = String(a.dataset.youtubeVideoId || '').trim();
		const url = String(a.dataset.youtubeUrl || '').trim();
		if (!videoId || !url) continue;

		const cached = getCachedYoutubeTitle(videoId);
		if (cached) {
			a.textContent = `YouTube: ${cached}`;
			a.dataset.youtubeTitleHydrated = 'true';
			continue;
		}

		let p = ytInFlight.get(videoId);
		if (!p) {
			p = fetch(`/api/youtube/oembed?url=${encodeURIComponent(url)}`, {
				method: 'GET',
				headers: {
					'Accept': 'application/json'
				}
			})
				.then(async (res) => {
					if (!res.ok) return null;
					const data = await res.json().catch(() => null);
					const title = typeof data?.title === 'string' ? data.title.trim() : '';
					return title || null;
				})
				.catch(() => null)
				.finally(() => {
					ytInFlight.delete(videoId);
				});
			ytInFlight.set(videoId, p);
		}

		void p.then((title) => {
			if (!title) return;
			setCachedYoutubeTitle(videoId, title);
			// Anchor might have been replaced; re-check by dataset videoId on this element.
			if (a.dataset.youtubeVideoId !== videoId) return;
			a.textContent = `YouTube: ${title}`;
			a.dataset.youtubeTitleHydrated = 'true';
		});
	}
}
