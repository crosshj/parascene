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

function extractXStatusInfo(url) {
	let parsed;
	try {
		parsed = new URL(String(url || ''));
	} catch {
		return null;
	}

	const host = parsed.hostname.toLowerCase();
	const pathname = parsed.pathname || '';

	const isXHost =
		host === 'x.com' ||
		host === 'www.x.com' ||
		host === 'twitter.com' ||
		host === 'www.twitter.com' ||
		host === 'mobile.twitter.com' ||
		host === 'm.twitter.com';

	if (!isXHost) return null;

	// twitter.com/{user}/status/{id}
	// x.com/{user}/status/{id}
	const m = pathname.match(/^\/([A-Za-z0-9_]{1,30})\/status\/(\d+)/);
	if (m) {
		return { user: m[1], statusId: m[2] };
	}

	// twitter.com/i/web/status/{id}
	const web = pathname.match(/^\/i\/web\/status\/(\d+)/);
	if (web) {
		return { user: '', statusId: web[1] };
	}

	// Some links use /statuses/{id}
	const statuses = pathname.match(/^\/([A-Za-z0-9_]{1,30})\/statuses\/(\d+)/);
	if (statuses) {
		return { user: statuses[1], statusId: statuses[2] };
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
 * - Initial label is `youtube {videoId}`
 * - Call `hydrateYoutubeLinkTitles(rootEl)` to asynchronously replace the link text with `youtube @handle - {title...}`
 *
 * Also detects X/Twitter post URLs and converts them into links with a consistent label:
 * - Initial label is `x-twitter @{user}` (or `x-twitter {statusId}` when username not present)
 * - Call `hydrateXLinkTitles(rootEl)` to asynchronously replace the link text with `x-twitter @handle - {excerpt...}` when available
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
			out += `<a href="${safeUrl}" class="user-link creation-link" target="_blank" rel="noopener noreferrer" data-youtube-url="${safeUrl}" data-youtube-video-id="${escapeHtml(videoId)}">youtube ${escapeHtml(videoId)}</a>`;
			out += escapeHtml(trailing);
			lastIndex = start + rawUrl.length;
			continue;
		}

		const x = extractXStatusInfo(url);
		if (x?.statusId) {
			const safeUrl = escapeHtml(url);
			const statusId = escapeHtml(x.statusId);
			const user = typeof x.user === 'string' ? x.user.trim() : '';
			const label = user ? `@${user}` : x.statusId;
			out += `<a href="${safeUrl}" class="user-link creation-link" target="_blank" rel="noopener noreferrer" data-x-url="${safeUrl}" data-x-status-id="${statusId}" data-x-user="${escapeHtml(user)}">x-twitter ${escapeHtml(label)}</a>`;
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

const YT_TITLE_CACHE_PREFIX = 'ps_yt_title_v2:';
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
		if (!title) return null;
		const creator = typeof parsed.creator === 'string' ? parsed.creator.trim() : '';
		return { title, creator };
	} catch {
		return null;
	}
}

function setCachedYoutubeTitle(videoId, { title, creator } = {}) {
	try {
		const key = `${YT_TITLE_CACHE_PREFIX}${videoId}`;
		localStorage.setItem(key, JSON.stringify({ title, creator, savedAt: Date.now() }));
	} catch {
		// Ignore storage errors (quota, privacy mode, etc.)
	}
}

function clipText(value, { max = 80 } = {}) {
	const s = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
	if (!s) return '';
	if (s.length <= max) return s;
	return `${s.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function formatYoutubeLabel({ title, creator } = {}) {
	const t = typeof title === 'string' ? title.trim() : '';
	const c = typeof creator === 'string' ? creator.trim() : '';

	if (c && t) return `youtube ${c} - ${clipText(t)}`;
	if (t) return `youtube - ${clipText(t)}`;
	return '';
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
			const label = formatYoutubeLabel(cached);
			if (label) a.textContent = label;
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
					const creator = typeof data?.creator === 'string' ? data.creator.trim() : '';
					if (!title) return null;
					return { title, creator };
				})
				.catch(() => null)
				.finally(() => {
					ytInFlight.delete(videoId);
				});
			ytInFlight.set(videoId, p);
		}

		void p.then((payload) => {
			if (!payload?.title) return;
			setCachedYoutubeTitle(videoId, payload);
			// Anchor might have been replaced; re-check by dataset videoId on this element.
			if (a.dataset.youtubeVideoId !== videoId) return;
			const label = formatYoutubeLabel(payload);
			if (label) a.textContent = label;
			a.dataset.youtubeTitleHydrated = 'true';
		});
	}
}

const X_TITLE_CACHE_PREFIX = 'ps_x_title_v2:';
const X_TITLE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const xInFlight = new Map();

function getCachedXTitle(statusId) {
	try {
		const key = `${X_TITLE_CACHE_PREFIX}${statusId}`;
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed.title !== 'string' || typeof parsed.savedAt !== 'number') return null;
		if (Date.now() - parsed.savedAt > X_TITLE_TTL_MS) return null;
		const title = parsed.title.trim();
		if (!title) return null;
		const tweetText = typeof parsed.tweetText === 'string' ? parsed.tweetText.trim() : '';
		return { title, tweetText };
	} catch {
		return null;
	}
}

function setCachedXTitle(statusId, { title, tweetText } = {}) {
	try {
		const key = `${X_TITLE_CACHE_PREFIX}${statusId}`;
		localStorage.setItem(key, JSON.stringify({ title, tweetText, savedAt: Date.now() }));
	} catch {
		// ignore
	}
}

function formatXLabel({ title, tweetText } = {}) {
	const who = typeof title === 'string' ? title.trim() : '';
	const text = typeof tweetText === 'string' ? tweetText.trim() : '';

	if (who && text) {
		return `x-twitter ${who} - ${clipText(text, { max: 120 })}`;
	}
	if (who) return `x-twitter ${who}`;
	return '';
}

export function hydrateXLinkTitles(rootEl) {
	const root = rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;

	const links = Array.from(root.querySelectorAll('a[data-x-status-id][data-x-url]'));
	for (const a of links) {
		if (!(a instanceof HTMLAnchorElement)) continue;
		if (a.dataset.xTitleHydrated === 'true') continue;

		const statusId = String(a.dataset.xStatusId || '').trim();
		const url = String(a.dataset.xUrl || '').trim();
		if (!statusId || !url) continue;

		const cached = getCachedXTitle(statusId);
		if (cached) {
			const label = formatXLabel(cached);
			if (label) a.textContent = label;
			a.dataset.xTitleHydrated = 'true';
			continue;
		}

		let p = xInFlight.get(statusId);
		if (!p) {
			p = fetch(`/api/x/oembed?url=${encodeURIComponent(url)}`, {
				method: 'GET',
				headers: {
					'Accept': 'application/json'
				}
			})
				.then(async (res) => {
					if (!res.ok) return null;
					const data = await res.json().catch(() => null);
					const title = typeof data?.title === 'string' ? data.title.trim() : '';
					const tweetText = typeof data?.tweetText === 'string' ? data.tweetText.trim() : '';
					if (!title) return null;
					return { title, tweetText };
				})
				.catch(() => null)
				.finally(() => {
					xInFlight.delete(statusId);
				});
			xInFlight.set(statusId, p);
		}

		void p.then((title) => {
			if (!title?.title) return;
			setCachedXTitle(statusId, title);
			if (a.dataset.xStatusId !== statusId) return;
			const label = formatXLabel(title);
			if (label) a.textContent = label;
			a.dataset.xTitleHydrated = 'true';
		});
	}
}
