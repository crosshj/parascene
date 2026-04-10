import { eyeHiddenIcon, linkIcon2 } from '../icons/svg-strings.js';

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

/**
 * Applies emoticon-to-emoji replacements in plain text segments.
 * Uses replaceAll so consecutive tokens (e.g. "<3<3<3") all convert.
 * Order matters: </3 before <3 so broken-heart is applied first.
 */
function applyEmojiTextTransforms(text) {
	let out = String(text ?? '');
	if (!out) return '';

	const transforms = [
		{ token: '</3', emoji: '💔' },
		{ token: '<3', emoji: '❤️' },
		{ token: ':-D', emoji: '😄' },
		{ token: ':D', emoji: '😄' },
		{ token: ':-)', emoji: '🙂' },
		{ token: ':)', emoji: '🙂' },
		{ token: ':-(', emoji: '🙁' },
		{ token: ':(', emoji: '🙁' },
		{ token: ';-)', emoji: '😉' },
		{ token: ';)', emoji: '😉' },
		{ token: ':-P', emoji: '😛', caseInsensitive: true },
		{ token: ':P', emoji: '😛', caseInsensitive: true },
	];

	for (const { token, emoji, caseInsensitive = false } of transforms) {
		const re = caseInsensitive
			? new RegExp(escapeRegExp(token), 'gi')
			: new RegExp(escapeRegExp(token), 'g');
		out = out.replaceAll(re, (match, offset, fullString) => {
			if (token !== '<3' && token !== '</3') return emoji;
			const before = fullString[offset - 1] ?? '';
			const after = fullString[offset + match.length] ?? '';
			// Don't replace when digit after (e.g. "1 <35") or digit before (e.g. "1<35") — but "3" before can be from "<3<3", so allow that
			const digitBefore = /\d/.test(before);
			const digitAfter = /\d/.test(after);
			const beforeIsFromHeart = token === '<3'
				? fullString.slice(offset - 2, offset) === '<3'
				: fullString.slice(offset - 3, offset) === '</3';
			if (digitAfter || (digitBefore && !beforeIsFromHeart)) return match;
			return emoji;
		});
	}

	return out;
}

function escapeRegExp(value) {
	return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderPlainUserTextSegment(text) {
	const transformed = applyEmojiTextTransforms(String(text ?? ''));
	if (!transformed) return '';

	// Conservative personality / tag / style token pattern:
	// - @ user, # tag channel, $ style → /styles/:slug (slug may start with a digit)
	// - Bounded so we don't transform emails/embedded tokens.
	const tokenRe = /(^|[^a-zA-Z0-9_-])([@#$])([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})(?=$|[^a-zA-Z0-9_-])/g;
	let out = '';
	let lastIndex = 0;
	let match;
	while ((match = tokenRe.exec(transformed)) !== null) {
		const leading = match[1] || '';
		const sigil = match[2] || '';
		const rawToken = match[3] || '';
		const mentionStart = match.index + leading.length;
		const mentionEnd = mentionStart + 1 + rawToken.length;

		out += escapeHtml(transformed.slice(lastIndex, mentionStart));

		const normalized = rawToken.toLowerCase();
		if (sigil === '@' && /^[a-z0-9][a-z0-9_-]{2,23}$/.test(normalized)) {
			out += `<a href="/p/${escapeHtml(normalized)}" class="user-link mention-link">@${escapeHtml(rawToken)}</a>`;
		} else if (sigil === '#' && /^[a-z0-9][a-z0-9_-]{1,31}$/.test(normalized)) {
			out += `<a href="/t/${escapeHtml(normalized)}" class="user-link mention-link">#${escapeHtml(rawToken)}</a>`;
		} else if (sigil === '$' && /^(?=.*[a-z])[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
			out += `<a href="/styles/${escapeHtml(normalized)}" class="user-link mention-link mention-link--style">$${escapeHtml(rawToken)}</a>`;
		} else {
			out += escapeHtml(`${sigil}${rawToken}`);
		}
		lastIndex = mentionEnd;
	}

	out += escapeHtml(transformed.slice(lastIndex));
	return out;
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
		// Sometimes URLs are wrapped like "(https://...)". Only strip closing brackets
		// when they are unmatched (more closing than opening), so that URLs which
		// legitimately end with ) like Wikipedia's Death_Dealer_(painting) stay intact.
		if ((last === ')' || last === ']' || last === '}') && url.length > 1) {
			const openCount = (url.match(/\(/g) || []).length;
			const closeCount = (url.match(/\)/g) || []).length;
			const openB = (url.match(/\[/g) || []).length;
			const closeB = (url.match(/\]/g) || []).length;
			const openC = (url.match(/\{/g) || []).length;
			const closeC = (url.match(/\}/g) || []).length;
			const unmatched =
				(last === ')' && closeCount > openCount) ||
				(last === ']' && closeB > openB) ||
				(last === '}' && closeC > openC);
			if (unmatched) {
				trailing = last + trailing;
				url = url.slice(0, -1);
				safety++;
				continue;
			}
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

/** Default app origin for client-side fallback (e.g. SSR). Single place to change app domain in client code. */
export const DEFAULT_APP_ORIGIN = 'https://www.parascene.com';

/** Share links host (must match `SHARE_HOSTNAME` in api_routes/utils/url.js). */
const PARASCENE_SHARE_HOST = 'sh.parascene.com';

/**
 * Expands bare paths like `/creations/123` (not already `https://...`) into absolute URLs
 * so the main URL pass can turn them into same-origin links. Does not match `/creations/123/edit`.
 */
function expandBareCreationPathsToAbsoluteUrls(text) {
	const origin =
		typeof window !== 'undefined' && window.location?.origin
			? window.location.origin
			: DEFAULT_APP_ORIGIN;
	return String(text ?? '').replace(
		/(^|[\s(])(\/creations\/\d+)\/?(?=\s|$|[.,!?;:)]|\)|\?|#)/g,
		(_, prefix, path) => `${prefix}${origin}${path}`
	);
}

/**
 * Chat uploads: bare `/api/images/generic/...` paths in message bodies become absolute so URL
 * linkification runs. Inline rendering is decided later by `isInlineEligibleGenericImagePath`.
 */
function isSafeGenericApiPath(relativePath) {
	const p = String(relativePath || '');
	if (!p.startsWith('/api/images/generic/') || p.includes('..')) return false;
	return /^\/api\/images\/generic\/(?:edited\/[^/]+\/[^/?#]+|profile\/[^/]+\/(?:generic|misc)_[^/?#]+)$/i.test(p);
}

function isInlineEligibleGenericImagePath(relativePath) {
	const p = String(relativePath || '');
	if (!isSafeGenericApiPath(p)) return false;
	if (p.startsWith('/api/images/generic/edited/')) {
		return /^\/api\/images\/generic\/edited\/[^/]+\/[^/?#]+$/i.test(p);
	}
	return /^\/api\/images\/generic\/profile\/[^/]+\/generic_[^/?#]+$/i.test(p);
}

function stripQueryAndHash(path) {
	let out = String(path || '');
	const q = out.indexOf('?');
	if (q >= 0) out = out.slice(0, q);
	const h = out.indexOf('#');
	if (h >= 0) out = out.slice(0, h);
	return out;
}

function extFromPathOrName(pathLike, nameLike = "") {
	const pickExt = (s) => {
		const raw = String(s || "");
		const i = raw.lastIndexOf(".");
		if (i <= 0 || i >= raw.length - 1) return "";
		return raw.slice(i + 1).toLowerCase();
	};
	return pickExt(pathLike) || pickExt(nameLike);
}

function isVideoExtension(ext) {
	return ["mp4", "mov", "m4v", "webm", "ogg", "ogv"].includes(String(ext || "").toLowerCase());
}

function isHtmlExtension(ext) {
	return ["html", "htm"].includes(String(ext || "").toLowerCase());
}

function formatAttachmentSize(bytesRaw) {
	const n = Number(bytesRaw);
	if (!Number.isFinite(n) || n <= 0) return '';
	if (n < 1024) return `${Math.floor(n)} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function attachmentNameFromPath(pathWithQuery) {
	const pathOnly = stripQueryAndHash(pathWithQuery);
	const seg = pathOnly.split('/').filter(Boolean).pop() || '';
	try {
		return decodeURIComponent(seg);
	} catch {
		return seg;
	}
}

function renderInlineGenericAttachmentCard(relativePath, originalUrl) {
	const href = escapeHtml(relativePath);
	const original = escapeHtml(originalUrl);
	let name = '';
	let sizeLabel = '';
	try {
		const u = new URL(relativePath, DEFAULT_APP_ORIGIN);
		name = String(u.searchParams.get('name') || '').trim();
		sizeLabel = formatAttachmentSize(u.searchParams.get('size'));
	} catch {
		name = '';
		sizeLabel = '';
	}
	if (!name) name = attachmentNameFromPath(relativePath);
	return `<span class="user-text-inline-file-wrap"><a href="${href}" class="user-link creation-link user-text-inline-file-link" target="_blank" rel="noopener noreferrer" data-creation-link-original="${original}"><span class="user-text-inline-file-icon" aria-hidden="true">file</span><span class="user-text-inline-file-meta"><span class="user-text-inline-file-name">${escapeHtml(name || 'attachment')}</span><span class="user-text-inline-file-size">${escapeHtml(sizeLabel || 'File')}</span></span></a></span>`;
}

function isInlineEligibleGenericVideoPath(relativePath) {
	const basePath = stripQueryAndHash(relativePath);
	if (!isSafeGenericApiPath(basePath)) return false;
	let queryName = "";
	try {
		const u = new URL(String(relativePath || ""), DEFAULT_APP_ORIGIN);
		queryName = String(u.searchParams.get("name") || "");
	} catch {
		queryName = "";
	}
	const ext = extFromPathOrName(basePath, queryName);
	return isVideoExtension(ext);
}

function isInlineEligibleGenericHtmlPath(relativePath) {
	const basePath = stripQueryAndHash(relativePath);
	if (!isSafeGenericApiPath(basePath)) return false;
	let queryName = "";
	try {
		const u = new URL(String(relativePath || ""), DEFAULT_APP_ORIGIN);
		queryName = String(u.searchParams.get("name") || "");
	} catch {
		queryName = "";
	}
	const ext = extFromPathOrName(basePath, queryName);
	return isHtmlExtension(ext);
}

function inlineGenericAttachmentTitle(relativePath) {
	let name = '';
	try {
		const u = new URL(String(relativePath || ''), DEFAULT_APP_ORIGIN);
		name = String(u.searchParams.get('name') || '').trim();
	} catch {
		name = '';
	}
	if (!name) name = attachmentNameFromPath(relativePath);
	return name || 'Video';
}

function renderInlineGenericVideo(relativePath, originalUrl) {
	const rp = escapeHtml(relativePath);
	const original = escapeHtml(originalUrl);
	const title = escapeHtml(inlineGenericAttachmentTitle(relativePath));
	return (
		`<span class="user-text-inline-video-wrap">` +
		`<div class="connect-chat-creation-embed-media connect-chat-creation-embed-media--has-hover-bar">` +
		`<div class="connect-chat-creation-embed-inner connect-chat-creation-embed-inner--video">` +
		`<button type="button" class="user-text-inline-video-play-overlay" aria-label="Play video">` +
		`<span class="user-text-inline-video-play-overlay-icon" aria-hidden="true">▶</span>` +
		`</button>` +
		`<div class="connect-chat-creation-embed-media-hover-bar">` +
		`<div class="connect-chat-creation-embed-hover-bar-main">` +
		`<span class="connect-chat-creation-embed-hover-bar-title">${title}</span>` +
		`</div>` +
		`<a class="connect-chat-creation-embed-detail-link connect-chat-creation-embed-detail-link--hover-bar user-link creation-link" href="${rp}" target="_blank" rel="noopener noreferrer" aria-label="Open video" title="Open video" data-creation-link-original="${original}">${linkIcon2()}</a>` +
		`</div>` +
		`<video class="connect-chat-creation-embed-video" playsinline loop preload="metadata" src="${rp}" aria-label="Attached video" data-inline-click-controls="1"></video>` +
		`</div></div></span>`
	);
}

function renderInlineGenericHtml(relativePath, originalUrl) {
	const rp = escapeHtml(relativePath);
	const original = escapeHtml(originalUrl);
	const title = escapeHtml(inlineGenericAttachmentTitle(relativePath));
	const bootstrapSrcdoc = escapeHtml(
		'<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="dark light"><style>html,body{margin:0;height:100%;background:#000;}@media (prefers-color-scheme: light){html,body{background:#fff;}}</style></head><body></body></html>'
	);
	return (
		`<span class="user-text-inline-html-wrap">` +
		`<div class="connect-chat-creation-embed connect-chat-creation-embed--square">` +
		`<div class="connect-chat-creation-embed-media connect-chat-creation-embed-media--has-hover-bar">` +
		`<div class="connect-chat-creation-embed-inner connect-chat-creation-embed-inner--html user-text-inline-html-frame">` +
		`<div class="connect-chat-creation-embed-media-hover-bar">` +
		`<div class="connect-chat-creation-embed-hover-bar-main">` +
		`<span class="connect-chat-creation-embed-hover-bar-title">${title}</span>` +
		`</div>` +
		`<a class="connect-chat-creation-embed-detail-link connect-chat-creation-embed-detail-link--hover-bar user-link creation-link" href="${rp}" target="_blank" rel="noopener noreferrer" aria-label="Open file" title="Open file" data-creation-link-original="${original}">${linkIcon2()}</a>` +
		`</div>` +
		`<div class="user-text-inline-html-skeleton" aria-hidden="true"></div>` +
		`<iframe class="user-text-inline-html-iframe" srcdoc="${bootstrapSrcdoc}" data-inline-html-src="${rp}" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-downloads" title="${title || "html preview"}"></iframe>` +
		`</div></div></div></span>`
	);
}

function expandBareInlineGenericImageApiPaths(text) {
	const origin =
		typeof window !== 'undefined' && window.location?.origin
			? window.location.origin
			: DEFAULT_APP_ORIGIN;
	return String(text ?? '').replace(
		/(^|[\s(])(\/api\/images\/generic\/[^\s"'<>]+)/g,
		(match, prefix, path) => {
			const q = path.indexOf('?');
			const h = path.indexOf('#');
			let base = path;
			if (q >= 0) base = base.slice(0, q);
			if (h >= 0) base = base.slice(0, h);
			if (!isSafeGenericApiPath(base)) return match;
			return `${prefix}${origin}${path}`;
		}
	);
}

const PARASCENE_HOSTS = [new URL(DEFAULT_APP_ORIGIN).hostname];

/**
 * If the URL points to parascene (same-origin or known parascene host), returns the relative
 * path (pathname + search + hash). Otherwise returns null.
 */
function getParasceneRelativePath(url) {
	try {
		const parsed = new URL(
			String(url || ''),
			typeof window !== 'undefined' && window.location
				? window.location.origin
				: DEFAULT_APP_ORIGIN
		);
		const host = parsed.hostname.toLowerCase();
		const isSameOrigin =
			typeof window !== 'undefined' &&
			window.location &&
			parsed.origin === window.location.origin;
		const isParasceneHost = PARASCENE_HOSTS.includes(host);
		if (!isSameOrigin && !isParasceneHost) return null;
		const path = parsed.pathname || '/';
		const search = parsed.search || '';
		const hash = parsed.hash || '';
		return path + search + hash;
	} catch {
		return null;
	}
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
	if (
		host === 'www.youtube.com' ||
		host === 'youtube.com' ||
		host === 'm.youtube.com'
	) {
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

function extractXHashtagInfo(url) {
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

	// x.com/hashtag/{tag}
	// twitter.com/hashtag/{tag}
	const m = pathname.match(/^\/hashtag\/([^/?#]+)/i);
	if (!m) return null;

	let tag = '';
	try {
		tag = decodeURIComponent(m[1] || '');
	} catch {
		tag = String(m[1] || '');
	}
	tag = tag.trim();
	if (!tag) return null;

	// Only allow the characters we want to display; keep it conservative.
	// (We still link to the original URL, but we don't want to render weird label text.)
	if (!/^[A-Za-z0-9_]{1,80}$/.test(tag)) return null;

	return { tag };
}

/**
 * Matches full URLs that point to a creation page (e.g. <app-origin>/creations/219).
 * Captures the creation ID for the replacement path.
 */
const CREATION_URL_RE = /https?:\/\/[^\s"'<>]+\/creations\/(\d+)\/?/g;

/**
 * Turns plain text into HTML that is safe to insert and converts full parascene URLs
 * (same-origin, e.g. <app-origin>/creations/219 or /feed) into relative
 * links that display as the path and navigate in-app.
 *
 * Also detects YouTube URLs and converts them into links with a consistent label:
 * - Initial label is `youtube {videoId}`
 * - Call `hydrateYoutubeLinkTitles(rootEl)` to asynchronously replace the link text with `youtube @handle - {title...}`
 *
 * Also detects X/Twitter post URLs and converts them into links with a consistent label:
 * - Initial label is `x-twitter @{user}` (or `x-twitter {statusId}` when username not present)
 * - Call `hydrateXLinkTitles(rootEl)` to asynchronously replace the link text with `x-twitter @handle - {excerpt...}` when available
 *
 * Any other http(s) URL is turned into a clickable link with the URL as the link text.
 *
 * Use when rendering user content such as image descriptions or comments.
 *
 * @param {string} text - Raw user text (may contain URLs and special characters)
 * @returns {string} - HTML-safe string with parascene URLs as relative <a href="..."> links
 */
export function textWithCreationLinks(text) {
	const raw = expandBareInlineGenericImageApiPaths(
		expandBareCreationPathsToAbsoluteUrls(String(text ?? ''))
	);
	if (!raw) return '';

	const urlRe = /https?:\/\/[^\s"'<>]+/g;
	let out = '';

	let lastIndex = 0;
	let match;
	while ((match = urlRe.exec(raw)) !== null) {
		const start = match.index;
		const rawUrl = match[0];

		out += renderPlainUserTextSegment(raw.slice(lastIndex, start));

		const { url, trailing } = splitUrlTrailingPunctuation(rawUrl);
		const relativePath = getParasceneRelativePath(url);
		if (relativePath) {
			const basePath = stripQueryAndHash(relativePath);
			if (isInlineEligibleGenericImagePath(basePath)) {
				const rp = escapeHtml(relativePath);
				out += `<span class="user-text-inline-image-wrap"><a href="${rp}" class="user-link creation-link user-text-inline-image-link" aria-label="View full image" data-creation-link-original="${escapeHtml(url)}"><img class="user-text-inline-image" src="${rp}" alt="" loading="lazy" decoding="async" /></a></span>`;
			} else if (isSafeGenericApiPath(basePath)) {
				out += renderInlineGenericAttachmentCard(relativePath, url);
			} else {
				out += `<a href="${escapeHtml(relativePath)}" class="user-link creation-link" data-creation-link-original="${escapeHtml(url)}">${escapeHtml(relativePath)}</a>`;
			}
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

		const xHashtag = extractXHashtagInfo(url);
		if (xHashtag?.tag) {
			const safeUrl = escapeHtml(url);
			const tag = escapeHtml(xHashtag.tag);
			out += `<a href="${safeUrl}" class="user-link creation-link" target="_blank" rel="noopener noreferrer">x-twitter #${tag}</a>`;
			out += escapeHtml(trailing);
			lastIndex = start + rawUrl.length;
			continue;
		}

		// Generic http(s) URL: turn into a clickable link (same styling as other user links).
		const safeUrl = escapeHtml(url);
		out += `<a href="${safeUrl}" class="user-link creation-link" target="_blank" rel="noopener noreferrer" data-creation-link-original="${escapeHtml(url)}">${safeUrl}</a>`;
		out += escapeHtml(trailing);
		lastIndex = start + rawUrl.length;
	}

	out += renderPlainUserTextSegment(raw.slice(lastIndex));
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
		if (
			!parsed ||
			typeof parsed.title !== 'string' ||
			typeof parsed.savedAt !== 'number'
		)
			return null;
		if (Date.now() - parsed.savedAt > YT_TITLE_TTL_MS) return null;
		const title = parsed.title.trim();
		if (!title) return null;
		const creator =
			typeof parsed.creator === 'string' ? parsed.creator.trim() : '';
		return { title, creator };
	} catch {
		return null;
	}
}

function setCachedYoutubeTitle(videoId, { title, creator } = {}) {
	try {
		const key = `${YT_TITLE_CACHE_PREFIX}${videoId}`;
		localStorage.setItem(
			key,
			JSON.stringify({ title, creator, savedAt: Date.now() })
		);
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
	const root =
		rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;

	const links = Array.from(
		root.querySelectorAll('a[data-youtube-video-id][data-youtube-url]')
	);
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
					Accept: 'application/json',
				},
			})
				.then(async (res) => {
					if (!res.ok) return null;
					const data = await res.json().catch(() => null);
					const title =
						typeof data?.title === 'string' ? data.title.trim() : '';
					const creator =
						typeof data?.creator === 'string' ? data.creator.trim() : '';
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
		if (
			!parsed ||
			typeof parsed.title !== 'string' ||
			typeof parsed.savedAt !== 'number'
		)
			return null;
		if (Date.now() - parsed.savedAt > X_TITLE_TTL_MS) return null;
		const title = parsed.title.trim();
		if (!title) return null;
		const tweetText =
			typeof parsed.tweetText === 'string' ? parsed.tweetText.trim() : '';
		return { title, tweetText };
	} catch {
		return null;
	}
}

function setCachedXTitle(statusId, { title, tweetText } = {}) {
	try {
		const key = `${X_TITLE_CACHE_PREFIX}${statusId}`;
		localStorage.setItem(
			key,
			JSON.stringify({ title, tweetText, savedAt: Date.now() })
		);
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
	const root =
		rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;

	const links = Array.from(
		root.querySelectorAll('a[data-x-status-id][data-x-url]')
	);
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
					Accept: 'application/json',
				},
			})
				.then(async (res) => {
					if (!res.ok) return null;
					const data = await res.json().catch(() => null);
					const title =
						typeof data?.title === 'string' ? data.title.trim() : '';
					const tweetText =
						typeof data?.tweetText === 'string' ? data.tweetText.trim() : '';
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

const creationEmbedDataCache = new Map();
const creationEmbedFetchInFlight = new Map();

function getCreationDetailIdFromHref(href) {
	try {
		const u = new URL(
			String(href || ''),
			typeof window !== 'undefined' && window.location
				? window.location.origin
				: DEFAULT_APP_ORIGIN
		);
		const m = (u.pathname || '').match(/^\/creations\/(\d+)\/?$/i);
		if (!m) return null;
		const id = Number(m[1]);
		return Number.isFinite(id) && id > 0 ? String(id) : null;
	} catch {
		return null;
	}
}

/**
 * Reads creation id from the signed share token payload (first segment before `.`), same encoding as server `mintShareToken`.
 */
function decodeImageIdFromShareTokenPayload(fullToken) {
	const raw = String(fullToken || '').trim();
	if (!raw.includes('.')) return null;
	const p = raw.split('.')[0];
	if (!p) return null;
	const padded =
		p.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((p.length + 3) % 4);
	try {
		const binary = atob(padded);
		if (binary.length < 3) return null;
		const b0 = binary.charCodeAt(0);
		const b1 = binary.charCodeAt(1);
		const b2 = binary.charCodeAt(2);
		const id = (b0 << 16) | (b1 << 8) | b2;
		return Number.isFinite(id) && id > 0 ? String(id) : null;
	} catch {
		return null;
	}
}

/**
 * @returns {{ id: string, shareVersion: string, shareToken: string } | null}
 */
function parseParasceneShareEmbedParams(href) {
	try {
		const u = new URL(
			String(href || ''),
			typeof window !== 'undefined' && window.location
				? window.location.origin
				: DEFAULT_APP_ORIGIN
		);
		if (u.hostname.toLowerCase() !== PARASCENE_SHARE_HOST) return null;
		const m = (u.pathname || '').match(/^\/s\/([^/]+)\/([^/]+)\/[^/]+\/?$/);
		if (!m) return null;
		const shareVersion = m[1];
		const shareToken = m[2];
		const id = decodeImageIdFromShareTokenPayload(shareToken);
		if (!id) return null;
		return { id, shareVersion, shareToken };
	} catch {
		return null;
	}
}

function trimWhitespaceOnlyTextNodes(el) {
	if (!(el instanceof HTMLElement)) return;
	let n = el.lastChild;
	while (n && n.nodeType === Node.TEXT_NODE && /^\s*$/.test(n.textContent)) {
		const prev = n.previousSibling;
		el.removeChild(n);
		n = prev;
	}
	n = el.firstChild;
	while (n && n.nodeType === Node.TEXT_NODE && /^\s*$/.test(n.textContent)) {
		const next = n.nextSibling;
		el.removeChild(n);
		n = next;
	}
}

/**
 * Plain title for display in the embed hover bar (empty if no title).
 * @param {object | null} data - Creation payload from GET /api/create/images/:id (or null when unavailable).
 * @returns {string}
 */
function creationEmbedTitleDisplayText(data) {
	if (!data || data._error) {
		return '';
	}
	const titleRaw = typeof data.title === 'string' ? data.title.trim() : '';
	return titleRaw;
}

/**
 * Top bar: title, optional source URL line, open-creation control (image + video embeds).
 * @param {{ creationId: string, titleText: string, sourceLabel: string, barStatic?: boolean }} opts
 * @returns {string}
 */
function chatCreationEmbedMediaHoverBarHtml({
	creationId,
	titleText,
	sourceLabel,
	barStatic = false,
}) {
	const staticClass = barStatic ? ' connect-chat-creation-embed-media-hover-bar--static' : '';
	const titleRaw = typeof titleText === 'string' ? titleText.trim() : '';
	const source = (sourceLabel || '').trim();
	let titleLine;
	if (titleRaw === 'Still processing…') {
		titleLine = `<span class="connect-chat-creation-embed-hover-bar-title connect-chat-creation-embed-hover-bar-title--pending">${escapeHtml(titleRaw)}</span>`;
	} else if (titleRaw) {
		titleLine = `<span class="connect-chat-creation-embed-hover-bar-title">${escapeHtml(titleRaw)}</span>`;
	} else {
		titleLine =
			'<span class="connect-chat-creation-embed-hover-bar-title connect-chat-creation-embed-hover-bar-title--untitled"><em>untitled</em></span>';
	}
	const sourceLine = source
		? `<span class="connect-chat-creation-embed-hover-bar-source" title="${escapeHtml(source)}">${escapeHtml(source)}</span>`
		: '';
	return (
		`<div class="connect-chat-creation-embed-media-hover-bar${staticClass}">` +
		`<div class="connect-chat-creation-embed-hover-bar-main">` +
		titleLine +
		sourceLine +
		`</div>` +
		`${chatCreationEmbedDetailLinkHtml(creationId, { variant: 'hover-bar' })}` +
		`</div>`
	);
}

/**
 * @param {string} creationId
 * @param {{ variant?: 'hover-bar' }} [opts]
 */
function chatCreationEmbedDetailLinkHtml(creationId, opts = {}) {
	const detailPageHref = `/creations/${encodeURIComponent(creationId)}`;
	const variantClass =
		opts.variant === 'hover-bar' ? ' connect-chat-creation-embed-detail-link--hover-bar' : '';
	return (
		`<a class="connect-chat-creation-embed-detail-link${variantClass}" href="${escapeHtml(detailPageHref)}" aria-label="Open creation" title="Open creation">${linkIcon2()}</a>`
	);
}

/**
 * Same visuals as `.route-media.route-media-error` / moderated icon on feed and creation detail.
 * Title appears in the top bar (static); the tile communicates failure/moderation.
 * @param {{ moderated?: boolean, titleText?: string, creationId?: string }} opts
 * @returns {string}
 */
function chatCreationEmbedFailureHtml({ moderated = false, titleText = '', creationId } = {}) {
	const modClass = moderated ? ' route-media-error-moderated' : '';
	const iconHtml = moderated
		? `<span class="route-media-error-moderated-icon" role="img" aria-label="Content moderated">${eyeHiddenIcon()}</span>`
		: '';
	const id = creationId && String(creationId).trim() ? String(creationId).trim() : '';
	const barHtml = id
		? chatCreationEmbedMediaHoverBarHtml({
				creationId: id,
				titleText: typeof titleText === 'string' ? titleText : '',
				sourceLabel: '',
				barStatic: true,
			})
		: '';
	return (
		`<div class="connect-chat-creation-embed-media connect-chat-creation-embed-media--has-hover-bar">` +
		`<div class="connect-chat-creation-embed-inner connect-chat-creation-embed-inner--error-layout">` +
		barHtml +
		`<div class="route-media route-media-error connect-chat-creation-embed-route-error${modClass}" aria-hidden="true">${iconHtml}</div></div></div>`
	);
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLImageElement | HTMLVideoElement} mediaEl
 */
function bindChatCreationEmbedMediaLoadError(wrap, mediaEl) {
	if (!(wrap instanceof HTMLElement) || !(mediaEl instanceof HTMLImageElement || mediaEl instanceof HTMLVideoElement)) {
		return;
	}
		const onFail = () => {
		if (!wrap.parentNode) return;
		wrap.classList.remove('connect-chat-creation-embed--loading', 'connect-chat-creation-embed--pending');
		wrap.classList.add('connect-chat-creation-embed--error');
		const titleEl = wrap.querySelector('.connect-chat-creation-embed-hover-bar-title');
		const titlePlain = titleEl && titleEl.textContent ? titleEl.textContent.trim() : '';
		const id = String(wrap.getAttribute('data-creation-id') || '').trim();
		wrap.innerHTML = chatCreationEmbedFailureHtml({
			moderated: false,
			titleText: titlePlain,
			creationId: id,
		});
		trimWhitespaceOnlyTextNodes(wrap);
		attachChatCreationEmbedDetailLinkReveal(wrap);
		wrap.setAttribute('role', 'status');
	};
	mediaEl.addEventListener('error', onFail, { once: true });
}

/**
 * Long-press reveals the top bar (title / URL / open-creation). Desktop with a mouse uses CSS :hover only.
 * Uses Pointer Events + movement threshold so tiny touchmove jitter on iOS does not cancel the timer.
 * @param {HTMLElement} wrap - `.connect-chat-creation-embed`
 */
function attachChatCreationEmbedDetailLinkReveal(wrap) {
	if (!(wrap instanceof HTMLElement)) return;
	if (wrap.dataset.chatCreationEmbedDetailReveal === '1') return;
	if (!wrap.querySelector('.connect-chat-creation-embed-detail-link')) return;
	if (typeof window === 'undefined' || !window.matchMedia) return;
	/* Primary input is a fine pointer + hover (real mouse): rely on CSS :hover only. */
	const desktopMouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
	if (desktopMouse) return;

	wrap.dataset.chatCreationEmbedDetailReveal = '1';

	const LONG_MS = 500;
	/* Cancel long-press only if finger moves past this (avoids iOS touchmove noise while holding). */
	const MOVE_THRESHOLD_PX = 20;
	const MOVE_THRESHOLD_SQ = MOVE_THRESHOLD_PX * MOVE_THRESHOLD_PX;

	let timer = null;
	let activePointerId = null;
	let startX = 0;
	let startY = 0;
	/** @type {((e: PointerEvent) => void) | null} */
	let docListener = null;

	const clearTimer = () => {
		if (timer) {
			window.clearTimeout(timer);
			timer = null;
		}
	};

	const removeReveal = () => {
		wrap.classList.remove('connect-chat-creation-embed--link-revealed');
		if (docListener) {
			document.removeEventListener('pointerdown', docListener, true);
			docListener = null;
		}
	};

	const addDocListener = () => {
		if (docListener) return;
		docListener = (e) => {
			const link = wrap.querySelector('.connect-chat-creation-embed-detail-link');
			if (wrap.contains(e.target)) {
				if (link && link.contains(e.target)) return;
				removeReveal();
				return;
			}
			removeReveal();
		};
		document.addEventListener('pointerdown', docListener, true);
	};

	const linkContains = (target) => {
		const link = wrap.querySelector('.connect-chat-creation-embed-detail-link');
		return !!(link && target && link.contains(target));
	};

	const onPointerDown = (e) => {
		if (e.pointerType === 'mouse' || e.button !== 0) return;
		if (linkContains(/** @type {Node} */ (e.target))) return;
		clearTimer();
		activePointerId = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		try {
			wrap.setPointerCapture(e.pointerId);
		} catch {
			// ignore
		}
		timer = window.setTimeout(() => {
			timer = null;
			wrap.classList.add('connect-chat-creation-embed--link-revealed');
			addDocListener();
		}, LONG_MS);
	};

	const onPointerMove = (e) => {
		if (activePointerId === null || e.pointerId !== activePointerId) return;
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if (dx * dx + dy * dy > MOVE_THRESHOLD_SQ) {
			clearTimer();
		}
	};

	const endPointer = (e) => {
		if (activePointerId === null || e.pointerId !== activePointerId) return;
		activePointerId = null;
		clearTimer();
		try {
			if (typeof wrap.hasPointerCapture === 'function' && wrap.hasPointerCapture(e.pointerId)) {
				wrap.releasePointerCapture(e.pointerId);
			}
		} catch {
			// ignore
		}
	};

	wrap.addEventListener('pointerdown', onPointerDown, { passive: true });
	wrap.addEventListener('pointermove', onPointerMove, { passive: true });
	wrap.addEventListener('pointerup', endPointer, { passive: true });
	wrap.addEventListener('pointercancel', endPointer, { passive: true });
	wrap.addEventListener('lostpointercapture', endPointer, { passive: true });

	/* Android Chrome: long-press on <video> opens “Download / Open in browser”. Suppress on media only;
	   allow the top bar (title, URL, open link) to keep text/link menus. */
	wrap.addEventListener(
		'contextmenu',
		(e) => {
			const t = e.target;
			if (!(t instanceof Element)) return;
			if (t.closest('.connect-chat-creation-embed-media-hover-bar')) return;
			e.preventDefault();
		},
		true
	);
}

async function fetchCreationForChatEmbed(id, shareOpts) {
	const shareVersion =
		shareOpts && typeof shareOpts.shareVersion === 'string' ? shareOpts.shareVersion.trim() : '';
	const shareToken =
		shareOpts && typeof shareOpts.shareToken === 'string' ? shareOpts.shareToken.trim() : '';
	const cacheKey =
		shareVersion && shareToken ? `${id}\0${shareVersion}\0${shareToken}` : id;
	if (creationEmbedDataCache.has(cacheKey)) {
		return creationEmbedDataCache.get(cacheKey);
	}
	let p = creationEmbedFetchInFlight.get(cacheKey);
	if (!p) {
		p = (async () => {
			const headers = { Accept: 'application/json' };
			if (shareVersion && shareToken) {
				headers['X-Share-Version'] = shareVersion;
				headers['X-Share-Token'] = shareToken;
			}
			const res = await fetch(`/api/create/images/${encodeURIComponent(id)}`, {
				method: 'GET',
				credentials: 'include',
				headers,
			});
			if (!res.ok) {
				return { _error: true, status: res.status };
			}
			const data = await res.json().catch(() => null);
			if (!data || typeof data !== 'object') {
				return { _error: true };
			}
			creationEmbedDataCache.set(cacheKey, data);
			return data;
		})().finally(() => {
			creationEmbedFetchInFlight.delete(cacheKey);
		});
		creationEmbedFetchInFlight.set(cacheKey, p);
	}
	return p;
}

/**
 * After chat bubbles render `processUserText`, call this to fetch creation metadata and show
 * an image (or video) preview for `/creations/:id` or Parascene share links (`sh…/s/…`) the viewer can access
 * (GET /api/create/images/:id, with optional `X-Share-Version` / `X-Share-Token` for unpublished creations).
 *
 * @param {Element|Document} rootEl - Container (e.g. [data-chat-messages])
 */
export function hydrateChatCreationEmbeds(rootEl) {
	const root =
		rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;

	const links = Array.from(root.querySelectorAll('a.creation-link[href]'));
	for (const a of links) {
		if (!(a instanceof HTMLAnchorElement)) continue;
		if (a.dataset.chatCreationEmbed === 'true') continue;
		const href = a.getAttribute('href') || '';
		const detailId = getCreationDetailIdFromHref(href);
		const share = parseParasceneShareEmbedParams(href);
		const creationId = detailId || (share ? share.id : null);
		if (!creationId) continue;
		const shareOpts =
			share && !detailId
				? { shareVersion: share.shareVersion, shareToken: share.shareToken }
				: null;
		a.dataset.chatCreationEmbed = 'true';
		a.classList.add('connect-chat-creation-embed-paired-link');

		const wrap = document.createElement('div');
		wrap.className =
			'connect-chat-creation-embed connect-chat-creation-embed--loading connect-chat-creation-embed--square';
		wrap.setAttribute('data-creation-id', creationId);
		wrap.innerHTML = '<div class="connect-chat-creation-embed-skeleton" aria-hidden="true"></div>';
		a.insertAdjacentElement('afterend', wrap);

		void fetchCreationForChatEmbed(creationId, shareOpts).then((data) => {
			if (!wrap.parentNode) return;
			wrap.classList.remove('connect-chat-creation-embed--loading');

			if (!data || data._error) {
				wrap.classList.add('connect-chat-creation-embed--error');
				wrap.innerHTML = chatCreationEmbedFailureHtml({
					moderated: false,
					titleText: '',
					creationId,
				});
				trimWhitespaceOnlyTextNodes(wrap);
				attachChatCreationEmbedDetailLinkReveal(wrap);
				wrap.setAttribute('role', 'status');
				return;
			}

			const titleDisplay = creationEmbedTitleDisplayText(data);

			const moderated = !!data.is_moderated_error;
			if (moderated) {
				wrap.classList.add('connect-chat-creation-embed--error');
				wrap.innerHTML = chatCreationEmbedFailureHtml({
					moderated: true,
					titleText: titleDisplay,
					creationId,
				});
				trimWhitespaceOnlyTextNodes(wrap);
				attachChatCreationEmbedDetailLinkReveal(wrap);
				wrap.setAttribute('role', 'status');
				return;
			}

			const statusRaw =
				typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'completed';
			const isPending =
				statusRaw === 'creating' ||
				statusRaw === 'processing' ||
				statusRaw === 'queued' ||
				statusRaw === 'pending';
			const isFailed = statusRaw === 'failed' || statusRaw === 'error';

			const mediaType =
				typeof data.media_type === 'string' ? data.media_type : 'image';
			const videoUrl =
				typeof data.video_url === 'string' ? data.video_url.trim() : '';
			const url = typeof data.url === 'string' ? data.url.trim() : '';
			const titleRaw =
				typeof data.title === 'string' ? data.title.trim() : '';

			const isNsfw = !!data.nsfw;
			const nsfwClass = isNsfw ? ' nsfw' : '';
			const nsfwDataAttr = isNsfw
				? ` data-creation-id="${escapeHtml(String(creationId))}"`
				: '';

			if (isFailed) {
				wrap.classList.add('connect-chat-creation-embed--error');
				wrap.innerHTML = chatCreationEmbedFailureHtml({
					moderated: false,
					titleText: titleDisplay,
					creationId,
				});
				trimWhitespaceOnlyTextNodes(wrap);
				attachChatCreationEmbedDetailLinkReveal(wrap);
				wrap.setAttribute('role', 'status');
				return;
			}

			if (statusRaw !== 'completed' || (!url && !(mediaType === 'video' && videoUrl))) {
				if (isPending) {
					wrap.classList.add('connect-chat-creation-embed--pending');
					wrap.innerHTML =
						'<div class="connect-chat-creation-embed-media connect-chat-creation-embed-media--has-hover-bar">' +
						'<div class="connect-chat-creation-embed-inner connect-chat-creation-embed-inner--pending">' +
						chatCreationEmbedMediaHoverBarHtml({
							creationId,
							titleText: 'Still processing…',
							sourceLabel: '',
							barStatic: true,
						}) +
						'<div class="connect-chat-creation-embed-skeleton connect-chat-creation-embed-skeleton--pending-fill" aria-hidden="true"></div>' +
						'</div></div>';
					trimWhitespaceOnlyTextNodes(wrap);
					attachChatCreationEmbedDetailLinkReveal(wrap);
					wrap.setAttribute('role', 'status');
					return;
				}
				wrap.classList.add('connect-chat-creation-embed--error');
				wrap.innerHTML = chatCreationEmbedFailureHtml({
					moderated: false,
					titleText: titleDisplay,
					creationId,
				});
				trimWhitespaceOnlyTextNodes(wrap);
				attachChatCreationEmbedDetailLinkReveal(wrap);
				wrap.setAttribute('role', 'status');
				return;
			}

			if (mediaType === 'video' && videoUrl) {
				const sourceLabelRaw =
					(a.getAttribute('data-creation-link-original') || '').trim() ||
					(a.getAttribute('href') || '').trim() ||
					'';
				const hoverBarHtml = chatCreationEmbedMediaHoverBarHtml({
					creationId,
					titleText: titleDisplay,
					sourceLabel: sourceLabelRaw,
				});
				// Keep --square on video too so it matches image dimensions (CSS handles square video frame).
				const poster = url ? ` poster="${escapeHtml(url)}"` : '';
				/* No whitespace between tags — otherwise pre-wrap line-height creates stray text nodes and gaps. */
				wrap.innerHTML = `<div class="connect-chat-creation-embed-media connect-chat-creation-embed-media--has-hover-bar"><div class="connect-chat-creation-embed-inner connect-chat-creation-embed-inner--video${nsfwClass}"${nsfwDataAttr}>${hoverBarHtml}<video class="connect-chat-creation-embed-video" autoplay muted loop controls playsinline controlslist="nodownload" preload="metadata" src="${escapeHtml(videoUrl)}"${poster}></video></div></div>`;
				trimWhitespaceOnlyTextNodes(wrap);
				const vid = wrap.querySelector('.connect-chat-creation-embed-video');
				if (vid instanceof HTMLVideoElement) {
					bindChatCreationEmbedMediaLoadError(wrap, vid);
				}
				attachChatCreationEmbedDetailLinkReveal(wrap);
				return;
			}

			if (url) {
				const sourceLabelRaw =
					(a.getAttribute('data-creation-link-original') || '').trim() ||
					(a.getAttribute('href') || '').trim() ||
					'';
				const hoverBarHtml = chatCreationEmbedMediaHoverBarHtml({
					creationId,
					titleText: titleDisplay,
					sourceLabel: sourceLabelRaw,
				});
				const alt =
					titleRaw.length > 0 ? escapeHtml(titleRaw) : 'untitled';
				wrap.innerHTML = `<div class="connect-chat-creation-embed-media connect-chat-creation-embed-media--has-hover-bar"><div class="connect-chat-creation-embed-inner${nsfwClass}"${nsfwDataAttr}>${hoverBarHtml}<img class="connect-chat-creation-embed-img" src="${escapeHtml(url)}" alt="${alt}" loading="lazy" decoding="async" /></div></div>`;
				trimWhitespaceOnlyTextNodes(wrap);
				const img = wrap.querySelector('.connect-chat-creation-embed-img');
				if (img instanceof HTMLImageElement) {
					bindChatCreationEmbedMediaLoadError(wrap, img);
				}
				attachChatCreationEmbedDetailLinkReveal(wrap);
				return;
			}

			wrap.classList.add('connect-chat-creation-embed--error');
			wrap.innerHTML = chatCreationEmbedFailureHtml({
				moderated: false,
				titleText: titleDisplay,
				creationId,
			});
			trimWhitespaceOnlyTextNodes(wrap);
			attachChatCreationEmbedDetailLinkReveal(wrap);
			wrap.setAttribute('role', 'status');
		});
	}
}

/**
 * Generic string processor for user-generated content.
 * Processes text to convert URLs into links and hydrates special link types (YouTube, X).
 *
 * This is the main function to use when rendering user content anywhere in the app.
 * It handles:
 * - Parascene (same-origin) URLs → relative links (/creations/123, /feed, etc.)
 * - YouTube URLs → links with titles (hydrated asynchronously)
 * - X/Twitter URLs → links with titles (hydrated asynchronously)
 * - Generic http(s) URLs → clickable links
 *
 * Usage:
 * ```js
 * // When rendering HTML:
 * element.innerHTML = processUserText(userContent);
 * hydrateUserTextLinks(element); // Call after inserting into DOM
 *
 * // Or in template strings:
 * html`<div>${processUserText(userContent)}</div>`
 * // Then call hydrateUserTextLinks(container) after rendering
 * ```
 *
 * @param {string} text - Raw user text (may contain URLs and special characters)
 * @returns {string} - HTML-safe string with all URLs converted to links
 */
export function processUserText(text) {
	return textWithCreationLinks(text);
}

/**
 * Hydrates all special link types (YouTube, X) within a container element.
 * Call this after inserting processed user text into the DOM.
 *
 * @param {Element|Document} rootEl - Container element or document to search within
 */
export function hydrateUserTextLinks(rootEl) {
	hydrateYoutubeLinkTitles(rootEl);
	hydrateXLinkTitles(rootEl);
}
