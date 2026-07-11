import { eyeHiddenIcon, linkIcon2 } from '/icons/svg-strings.js';
import { isChatBroadcastMentionSlug } from './chatBroadcastMentions.js';
import { SPECIAL_HASHTAG_HREFS } from './hashtagDestination.js';
import {
	attachMediaAudioLeveling,
	primeMediaElementForAudioLeveling
} from './mediaAudioLeveling.js';
import { mountSequentialVideoPlayer } from './sequentialVideoPlayer.js';

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

function renderPlainUserTextSegmentBase(text) {
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
		if (sigil === '@' && isChatBroadcastMentionSlug(normalized)) {
			out += `<span class="mention-broadcast" data-broadcast="${escapeHtml(normalized)}">@${escapeHtml(rawToken)}</span>`;
		} else if (sigil === '@' && /^[a-z0-9][a-z0-9_-]{2,23}$/.test(normalized)) {
			out += `<a href="/p/${escapeHtml(normalized)}" class="user-link mention-link">@${escapeHtml(rawToken)}</a>`;
		} else if (sigil === '#' && /^[a-z0-9][a-z0-9_-]{1,31}$/.test(normalized)) {
			const specialHashtagHref = SPECIAL_HASHTAG_HREFS[normalized] || '';
			const href = specialHashtagHref || `/t/${normalized}`;
			out += `<a href="${escapeHtml(href)}" class="user-link mention-link">#${escapeHtml(rawToken)}</a>`;
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

function renderInlineMarkdownText(text) {
	const raw = String(text ?? '');
	if (!raw) return '';
	const tokenRe = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
	let out = '';
	let lastIndex = 0;
	let match;
	while ((match = tokenRe.exec(raw)) !== null) {
		out += renderPlainUserTextSegmentBase(raw.slice(lastIndex, match.index));
		if (typeof match[1] === 'string') {
			out += `<code class="user-text-msg-inline-code">${escapeHtml(match[1])}</code>`;
		} else if (typeof match[2] === 'string') {
			out += `<strong class="user-text-msg-strong">${renderPlainUserTextSegmentBase(match[2])}</strong>`;
		} else if (typeof match[3] === 'string') {
			out += `<em class="user-text-msg-em">${renderPlainUserTextSegmentBase(match[3])}</em>`;
		}
		lastIndex = match.index + match[0].length;
	}
	out += renderPlainUserTextSegmentBase(raw.slice(lastIndex));
	return out;
}

function renderPlainUserTextSegment(text, { inlineMarkdown = false } = {}) {
	if (!inlineMarkdown) return renderPlainUserTextSegmentBase(text);
	return renderInlineMarkdownText(text);
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
export function expandBareCreationPathsToAbsoluteUrls(text) {
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

/** Same play glyph as doom scroll (`chat-doom-play-*`). */
const INLINE_CHAT_VIDEO_PLAY_OVERLAY_HTML =
	`<div class="chat-doom-play-overlay" aria-hidden="true">` +
	`<div class="chat-doom-play-overlay-inner">` +
	`<svg class="chat-doom-play-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>` +
	`</div></div>`;

function renderInlineGenericVideo(relativePath, originalUrl) {
	const rp = escapeHtml(relativePath);
	void originalUrl;
	/* Square placeholder until loaded; paused thumb with centered play icon only. */
	return (
		`<div class="connect-chat-creation-embed connect-chat-creation-embed--square is-loading" data-generic-video-embed="1">` +
		`<div class="connect-chat-creation-embed-media">` +
		`<div class="connect-chat-creation-embed-inner connect-chat-creation-embed-inner--video" role="button" tabindex="0" aria-label="Open video" title="Open video">` +
		`<video class="connect-chat-creation-embed-video" playsinline preload="metadata" src="${rp}" aria-label="Attached video" data-inline-video-loading="1"></video>` +
		INLINE_CHAT_VIDEO_PLAY_OVERLAY_HTML +
		`</div></div></div>`
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

const PARASCENE_HOSTS = [
	new URL(DEFAULT_APP_ORIGIN).hostname,
	'parascene.com'
];

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

const SUNO_UUID_RE =
	/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function extractSunoLinkInfo(url) {
	let parsed;
	try {
		parsed = new URL(String(url || ''));
	} catch {
		return null;
	}

	const host = parsed.hostname.toLowerCase();
	if (host !== 'suno.com' && host !== 'www.suno.com') return null;

	const pathname = parsed.pathname || '';

	const songMatch = pathname.match(/^\/song\/([a-f0-9-]{36})\/?$/i);
	if (songMatch?.[1] && SUNO_UUID_RE.test(songMatch[1])) {
		return { songId: songMatch[1].toLowerCase(), slug: '' };
	}

	const embedMatch = pathname.match(/^\/embed\/([a-f0-9-]{36})\/?$/i);
	if (embedMatch?.[1] && SUNO_UUID_RE.test(embedMatch[1])) {
		return { songId: embedMatch[1].toLowerCase(), slug: '' };
	}

	const shareMatch = pathname.match(/^\/s\/([A-Za-z0-9]{8,32})\/?$/);
	if (shareMatch?.[1]) {
		return { songId: '', slug: shareMatch[1] };
	}

	return null;
}

function sunoLinkLabel({ songId, slug }) {
	if (songId) return songId.slice(0, 8);
	if (slug) return slug;
	return 'suno';
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
 * Also detects Suno URLs (`/s/…`, `/song/…`, `/embed/…`) and converts them into links labeled `suno …`.
 * Call `hydrateSunoLinkTitles(rootEl)` and `hydrateSunoEmbeds(rootEl)` (or `hydrateRichUserTextEmbeds`) for titles and player embeds.
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
function textWithCreationLinksCore(text, { inlineMarkdown = false } = {}) {
	const raw = String(text ?? '');
	if (!raw) return '';

	const urlRe = /https?:\/\/[^\s"'<>]+/g;
	let out = '';

	let lastIndex = 0;
	let match;
	while ((match = urlRe.exec(raw)) !== null) {
		const start = match.index;
		const rawUrl = match[0];

		out += renderPlainUserTextSegment(raw.slice(lastIndex, start), { inlineMarkdown });

		const { url, trailing } = splitUrlTrailingPunctuation(rawUrl);
		const relativePath = getParasceneRelativePath(url);
		if (relativePath) {
			const basePath = stripQueryAndHash(relativePath);
			if (isInlineEligibleGenericImagePath(basePath)) {
				const rp = escapeHtml(relativePath);
				out += `<span class="user-text-inline-image-wrap is-loading"><a href="${rp}" class="user-link creation-link user-text-inline-image-link" aria-label="View full image" data-creation-link-original="${escapeHtml(url)}"><img class="user-text-inline-image" src="${rp}" alt="" width="260" height="260" loading="lazy" decoding="async" data-inline-image-loading="1" /></a></span>`;
			} else if (isInlineEligibleGenericVideoPath(relativePath)) {
				out += renderInlineGenericVideo(relativePath, url);
			} else if (isInlineEligibleGenericHtmlPath(relativePath)) {
				out += renderInlineGenericHtml(relativePath, url);
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

		const suno = extractSunoLinkInfo(url);
		if (suno) {
			const safeUrl = escapeHtml(url);
			const label = sunoLinkLabel(suno);
			const songAttr = suno.songId
				? ` data-suno-song-id="${escapeHtml(suno.songId)}"`
				: '';
			const slugAttr = suno.slug ? ` data-suno-slug="${escapeHtml(suno.slug)}"` : '';
			out += `<a href="${safeUrl}" class="user-link creation-link" target="_blank" rel="noopener noreferrer" data-suno-url="${safeUrl}"${songAttr}${slugAttr}>suno ${escapeHtml(label)}</a>`;
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

	out += renderPlainUserTextSegment(raw.slice(lastIndex), { inlineMarkdown });
	return out;
}

function renderMessageMarkdownLine(line, { isFirstItem = false } = {}) {
	const rawLine = String(line ?? '');
	if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(rawLine)) {
		return '<div class="user-text-msg-hr" role="separator" aria-hidden="true"></div>';
	}

	const quoteMatch = rawLine.match(/^\s*>\s?(.*)$/);
	if (quoteMatch) {
		const body = textWithCreationLinksCore(quoteMatch[1] || '', { inlineMarkdown: true });
		return `<div class="user-text-msg-quote">${body}</div>`;
	}

	const headingMatch = rawLine.match(/^\s*(#{1,})\s+(.*)$/);
	if (headingMatch) {
		const levelRaw = headingMatch[1] || '#';
		const level = Math.min(3, Math.max(1, levelRaw.length));
		const body = textWithCreationLinksCore(headingMatch[2] || '', { inlineMarkdown: true });
		const firstCls = isFirstItem ? ' user-text-msg-heading--first-item' : '';
		return `<div class="user-text-msg-h${level}${firstCls}">${body}</div>`;
	}

	return textWithCreationLinksCore(rawLine, { inlineMarkdown: true });
}

function renderMessageMarkdownText(rawText) {
	const lines = String(rawText ?? '').split('\n');
	const out = [];
	const codeLines = [];
	const listItems = [];
	let inCode = false;
	let listMode = '';
	let pendingSoftBreak = false;
	let prevInlineLine = false;

	const flushCode = () => {
		out.push(
			`<pre class="user-text-msg-code-block"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`
		);
		codeLines.length = 0;
	};

	const flushList = () => {
		if (!listMode || listItems.length === 0) {
			listMode = '';
			listItems.length = 0;
			return;
		}
		const taskCls = listMode === 'task' ? ' user-text-msg-list--task' : '';
		out.push(`<ul class="user-text-msg-list${taskCls}">${listItems.join('')}</ul>`);
		listMode = '';
		listItems.length = 0;
	};

	for (const line of lines) {
		if (String(line ?? '').trim() === '```') {
			flushList();
			pendingSoftBreak = false;
			prevInlineLine = false;
			if (inCode) {
				flushCode();
				inCode = false;
			} else {
				inCode = true;
				codeLines.length = 0;
			}
			continue;
		}
		if (inCode) {
			codeLines.push(String(line ?? ''));
			continue;
		}
		const rawLine = String(line ?? '');
		if (rawLine.trim() === '') {
			flushList();
			pendingSoftBreak = true;
			prevInlineLine = false;
			continue;
		}
		const checkboxMatch = rawLine.match(/^\s*-\s\[( |x|X)\]\s+(.*)$/);
		if (checkboxMatch) {
			if (listMode !== 'task') {
				flushList();
				listMode = 'task';
			}
			pendingSoftBreak = false;
			const checked = checkboxMatch[1].toLowerCase() === 'x';
			const checkedAttr = checked ? ' checked' : '';
			const label = textWithCreationLinksCore(checkboxMatch[2] || '', { inlineMarkdown: true });
			listItems.push(
				`<li class="user-text-msg-list-item user-text-msg-list-item--task"><input class="user-text-msg-checkbox-input" type="checkbox" disabled${checkedAttr} /><span class="user-text-msg-checkbox-label">${label}</span></li>`
			);
			prevInlineLine = false;
			continue;
		}
		const listMatch = rawLine.match(/^\s*-\s+(.*)$/);
		if (listMatch) {
			if (listMode !== 'ul') {
				flushList();
				listMode = 'ul';
			}
			pendingSoftBreak = false;
			const body = textWithCreationLinksCore(listMatch[1] || '', { inlineMarkdown: true });
			listItems.push(`<li class="user-text-msg-list-item">${body}</li>`);
			prevInlineLine = false;
			continue;
		}

		flushList();
		const isBlockLine =
			/^\s*(#{1,})\s+/.test(rawLine) ||
			/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(rawLine) ||
			/^\s*>\s?/.test(rawLine);
		if (!isBlockLine) {
			if (pendingSoftBreak && out.length > 0) {
				out.push('<br><br>');
			} else if (prevInlineLine && out.length > 0) {
				out.push('<br>');
			}
		}
		const rendered = renderMessageMarkdownLine(rawLine, { isFirstItem: out.length === 0 });
		if (rendered) out.push(rendered);
		pendingSoftBreak = false;
		prevInlineLine = !isBlockLine;
	}

	flushList();
	if (inCode) flushCode();
	return out.join('');
}

export function textWithCreationLinks(text, options = {}) {
	const raw = expandBareInlineGenericImageApiPaths(
		expandBareCreationPathsToAbsoluteUrls(String(text ?? ''))
	);
	if (!raw) return '';
	if (options && options.messageMarkdown === true) {
		return renderMessageMarkdownText(raw);
	}
	return textWithCreationLinksCore(raw);
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

const SUNO_RESOLVE_CACHE_PREFIX = 'ps_suno_resolve_v1:';
const SUNO_RESOLVE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const sunoResolveInFlight = new Map();

function getCachedSunoResolve(cacheKey) {
	try {
		const raw = localStorage.getItem(`${SUNO_RESOLVE_CACHE_PREFIX}${cacheKey}`);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (
			!parsed ||
			typeof parsed.songId !== 'string' ||
			typeof parsed.savedAt !== 'number'
		) {
			return null;
		}
		if (Date.now() - parsed.savedAt > SUNO_RESOLVE_TTL_MS) return null;
		return {
			songId: parsed.songId,
			title: typeof parsed.title === 'string' ? parsed.title : '',
			creator: typeof parsed.creator === 'string' ? parsed.creator : '',
		};
	} catch {
		return null;
	}
}

function setCachedSunoResolve(cacheKey, payload) {
	try {
		localStorage.setItem(
			`${SUNO_RESOLVE_CACHE_PREFIX}${cacheKey}`,
			JSON.stringify({
				songId: payload.songId,
				title: payload.title || '',
				creator: payload.creator || '',
				savedAt: Date.now(),
			})
		);
	} catch {
		// ignore quota / private mode
	}
}

function formatSunoLabel({ title, creator, songId, slug }) {
	const t = clipText(title, { max: 72 });
	const c = clipText(creator, { max: 40 });
	if (t && c) return `suno ${c} - ${t}`;
	if (t) return `suno - ${t}`;
	if (songId) return `suno ${songId.slice(0, 8)}`;
	if (slug) return `suno ${slug}`;
	return '';
}

function fetchSunoResolve(url) {
	const key = String(url || '').trim();
	if (!key) return Promise.resolve(null);
	const cached = getCachedSunoResolve(key);
	if (cached) return Promise.resolve(cached);

	let p = sunoResolveInFlight.get(key);
	if (!p) {
		p = fetch(`/api/suno/resolve?url=${encodeURIComponent(key)}`, {
			method: 'GET',
			headers: { Accept: 'application/json' },
		})
			.then(async (res) => {
				if (!res.ok) return null;
				const data = await res.json().catch(() => null);
				const songId =
					typeof data?.songId === 'string' ? data.songId.trim() : '';
				if (!songId || !SUNO_UUID_RE.test(songId)) return null;
				const payload = {
					songId,
					title: typeof data?.title === 'string' ? data.title.trim() : '',
					creator:
						typeof data?.creator === 'string' ? data.creator.trim() : '',
				};
				setCachedSunoResolve(key, payload);
				return payload;
			})
			.catch(() => null)
			.finally(() => {
				sunoResolveInFlight.delete(key);
			});
		sunoResolveInFlight.set(key, p);
	}
	return p;
}

export function hydrateSunoLinkTitles(rootEl) {
	const root =
		rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;

	const links = Array.from(root.querySelectorAll('a[data-suno-url][href]'));
	for (const a of links) {
		if (!(a instanceof HTMLAnchorElement)) continue;
		if (a.dataset.sunoTitleHydrated === 'true') continue;

		const url = String(a.dataset.sunoUrl || a.getAttribute('href') || '').trim();
		if (!url) continue;

		const slug = String(a.dataset.sunoSlug || '').trim();
		const songId = String(a.dataset.sunoSongId || '').trim();
		const cacheKey = url;

		const cached = getCachedSunoResolve(cacheKey);
		if (cached) {
			const label = formatSunoLabel({
				title: cached.title,
				creator: cached.creator,
				songId: cached.songId || songId,
				slug,
			});
			if (label) a.textContent = label;
			if (cached.songId) a.dataset.sunoSongId = cached.songId;
			a.dataset.sunoTitleHydrated = 'true';
			continue;
		}

		void fetchSunoResolve(url).then((payload) => {
			if (!payload?.songId) return;
			if (a.dataset.sunoUrl !== url && a.getAttribute('href') !== url) return;
			a.dataset.sunoSongId = payload.songId;
			const label = formatSunoLabel({
				title: payload.title,
				creator: payload.creator,
				songId: payload.songId,
				slug,
			});
			if (label) a.textContent = label;
			a.dataset.sunoTitleHydrated = 'true';
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

/**
 * Trim + expand bare `/creations/:id` paths like chat bodies (single-line hero/reference fields).
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeHeroMediaReferenceInput(raw) {
	const t = String(raw ?? '').trim();
	if (!t) return '';
	return expandBareCreationPathsToAbsoluteUrls(t);
}

/**
 * Creation detail URL (trusted Parascene origin) or `sh…/s/…` share URL → payload for {@link fetchCreationEmbedPayload}.
 * @param {unknown} raw
 * @returns {{ kind: 'creation', creationId: string, shareOpts: { shareVersion: string, shareToken: string } | null } | null}
 */
export function parseHeroCreationOrShareRef(raw) {
	const s = normalizeHeroMediaReferenceInput(raw);
	if (!s) return null;

	const share = parseParasceneShareEmbedParams(s);
	if (share) {
		return {
			kind: 'creation',
			creationId: share.id,
			shareOpts: { shareVersion: share.shareVersion, shareToken: share.shareToken }
		};
	}

	try {
		const u = new URL(
			s,
			typeof window !== 'undefined' && window.location?.origin
				? window.location.origin
				: DEFAULT_APP_ORIGIN
		);
		const host = u.hostname.toLowerCase();
		const isTrusted =
			(typeof window !== 'undefined' &&
				window.location &&
				u.origin === window.location.origin) ||
			PARASCENE_HOSTS.includes(host);
		if (!isTrusted) return null;
		const m = (u.pathname || '').match(/^\/creations\/(\d+)\/?$/i);
		if (!m) return null;
		const id = Number(m[1]);
		if (!Number.isFinite(id) || id <= 0) return null;
		return { kind: 'creation', creationId: String(id), shareOpts: null };
	} catch {
		return null;
	}
}

/**
 * Http(s) URL for `<img src>` when input is not a resolvable creation/share reference.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function parseHeroDirectMediaUrl(raw) {
	const s = normalizeHeroMediaReferenceInput(raw);
	if (!s) return null;
	try {
		const u = new URL(
			s,
			typeof window !== 'undefined' && window.location?.origin
				? window.location.origin
				: DEFAULT_APP_ORIGIN
		);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
		return u.href;
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

function orderGroupSourcesCoverFirst(groupSourcesRaw, coverSourceId) {
	const list = Array.isArray(groupSourcesRaw)
		? groupSourcesRaw.filter((item) => item && typeof item === 'object')
		: [];
	const coverId = Number(coverSourceId);
	if (!Number.isFinite(coverId) || coverId <= 0) return list;
	const coverIndex = list.findIndex((item) => Number(item.id) === coverId);
	if (coverIndex <= 0) return list;
	const ordered = [...list];
	const [coverSource] = ordered.splice(coverIndex, 1);
	ordered.unshift(coverSource);
	return ordered;
}

function buildGroupEmbedPosterUrl(source, creationIdNum, shareOpts) {
	const fp = typeof source?.file_path === 'string' ? source.file_path.trim() : '';
	if (!fp) return '';
	let urlWithDelegation = appendCreationIdToMediaUrl(fp, creationIdNum);
	if (shareOpts) {
		urlWithDelegation = appendShareAccessToMediaUrl(urlWithDelegation, shareOpts);
	}
	return urlWithDelegation;
}

/** @type {WeakMap<HTMLElement, ReturnType<typeof mountSequentialVideoPlayer>>} */
const chatEmbedGroupVideoPlayers = new WeakMap();

/**
 * @param {HTMLElement} innerCarousel
 * @param {Array<{ url?: string, width?: number, height?: number }>} slides
 * @param {string} posterUrl
 * @returns {ReturnType<typeof mountSequentialVideoPlayer> | null}
 */
function mountChatEmbedGroupVideoPlaylist(innerCarousel, slides, posterUrl) {
	if (!(innerCarousel instanceof HTMLElement) || !Array.isArray(slides) || slides.length <= 1) {
		return null;
	}

	const existing = chatEmbedGroupVideoPlayers.get(innerCarousel);
	if (existing && typeof existing.teardown === 'function') {
		existing.teardown();
		chatEmbedGroupVideoPlayers.delete(innerCarousel);
	}

	const stack = innerCarousel.querySelector('.connect-chat-creation-embed-group-stack');
	if (!(stack instanceof HTMLElement)) return null;

	innerCarousel.classList.add('connect-chat-creation-embed-inner--group-video-playlist');
	innerCarousel.removeAttribute('role');
	innerCarousel.removeAttribute('tabindex');
	innerCarousel.removeAttribute('aria-label');
	innerCarousel.removeAttribute('title');

	for (const img of stack.querySelectorAll('.connect-chat-creation-embed-group-img')) {
		img.remove();
	}
	const staticOverlay = innerCarousel.querySelector('.chat-doom-play-overlay');
	if (staticOverlay instanceof HTMLElement) staticOverlay.remove();

	const normalizedSlides = slides
		.map((slide) => {
			const w = Number(slide?.width);
			const h = Number(slide?.height);
			return {
				url: String(slide?.url || '').trim(),
				width: Number.isFinite(w) && w > 0 ? w : 0,
				height: Number.isFinite(h) && h > 0 ? h : 0,
			};
		})
		.filter((slide) => slide.url);
	if (normalizedSlides.length <= 1) return null;

	const player = mountSequentialVideoPlayer(stack, normalizedSlides, {
		startIndex: 0,
		loopPlaylist: true,
		autoAdvanceOnEnded: true,
		muted: true,
		videoClass: 'connect-chat-creation-embed-group-video',
		slotClass: 'connect-chat-creation-embed-group-video-slot sequential-video-player-slot',
		posterUrl: typeof posterUrl === 'string' ? posterUrl.trim() : '',
	});
	if (!player) return null;

	chatEmbedGroupVideoPlayers.set(innerCarousel, player);
	innerCarousel.dataset.chatEmbedGroupVideoPlaylist = '1';

	if ('IntersectionObserver' in window) {
		const io = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.target !== innerCarousel) continue;
					if (entry.isIntersecting) player.play();
					else player.pause();
				}
			},
			{ threshold: 0.5 }
		);
		io.observe(innerCarousel);
		innerCarousel._chatEmbedGroupVideoIo = io;
	} else {
		player.play();
	}

	return player;
}

function buildGroupEmbedVideoSlide(source, creationIdNum, shareOpts) {
	const meta = source?.meta && typeof source.meta === 'object' ? source.meta : null;
	const sourceMediaType = typeof meta?.media_type === 'string' ? meta.media_type : 'image';
	const videoPath = meta?.video?.file_path;
	if (sourceMediaType !== 'video' || typeof videoPath !== 'string' || !videoPath.trim()) return null;
	let videoUrl = appendCreationIdToMediaUrl(videoPath.trim(), creationIdNum);
	if (shareOpts) {
		videoUrl = appendShareAccessToMediaUrl(videoUrl, shareOpts);
	}
	const width = Number(source?.width);
	const height = Number(source?.height);
	return {
		url: videoUrl,
		width: Number.isFinite(width) && width > 0 ? width : 0,
		height: Number.isFinite(height) && height > 0 ? height : 0,
	};
}

function appendCreationIdToMediaUrl(url, creationId) {
	const raw = typeof url === 'string' ? url.trim() : '';
	const id = Number(creationId);
	if (!raw || !Number.isFinite(id) || id <= 0) return raw;
	if (!raw.includes('/api/images/created/') && !raw.includes('/api/videos/created/')) return raw;
	try {
		const parsed = new URL(raw, 'http://localhost');
		parsed.searchParams.set('creation_id', String(id));
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		const sep = raw.includes('?') ? '&' : '?';
		return `${raw}${sep}creation_id=${encodeURIComponent(String(id))}`;
	}
}

function appendShareAccessToMediaUrl(url, shareOpts) {
	const raw = typeof url === 'string' ? url.trim() : '';
	if (!raw || !shareOpts) return raw;
	if (/[?&]share_version=/.test(raw.split('#')[0])) return raw;
	const version =
		typeof shareOpts.shareVersion === 'string' ? shareOpts.shareVersion.trim() : '';
	const token = typeof shareOpts.shareToken === 'string' ? shareOpts.shareToken.trim() : '';
	if (!version || !token) return raw;
	if (!raw.includes('/api/images/created/') && !raw.includes('/api/videos/created/')) return raw;
	const [beforeHash, hash = ''] = raw.split('#');
	const sep = beforeHash.includes('?') ? '&' : '?';
	const next = `${beforeHash}${sep}share_version=${encodeURIComponent(version)}&share_token=${encodeURIComponent(token)}`;
	return hash ? `${next}#${hash}` : next;
}

/**
 * Same visuals as `.route-media.route-media-error` / moderated icon on feed and creation detail.
 * Optional title line above the icon when `titleText` is set.
 * @param {{ moderated?: boolean, titleText?: string }} opts
 * @returns {string}
 */
function chatCreationEmbedFailureHtml({ moderated = false, titleText = '' } = {}) {
	const modClass = moderated ? ' route-media-error-moderated' : '';
	const iconHtml = moderated
		? `<span class="route-media-error-moderated-icon" role="img" aria-label="Content moderated">${eyeHiddenIcon()}</span>`
		: '';
	const titleLine =
		typeof titleText === 'string' && titleText.trim()
			? `<div class="connect-chat-creation-embed-status-message">${escapeHtml(titleText.trim())}</div>`
			: '';
	return (
		`<div class="connect-chat-creation-embed-media">` +
		`<div class="connect-chat-creation-embed-inner connect-chat-creation-embed-inner--error-layout">` +
		titleLine +
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
		const titleEl =
			wrap.querySelector('.connect-chat-creation-embed-hover-bar-title') ||
			wrap.querySelector('.connect-chat-creation-embed-status-message');
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

export async function fetchCreationEmbedPayload(id, shareOpts, challengeOpts) {
	const shareVersion =
		shareOpts && typeof shareOpts.shareVersion === 'string' ? shareOpts.shareVersion.trim() : '';
	const shareToken =
		shareOpts && typeof shareOpts.shareToken === 'string' ? shareOpts.shareToken.trim() : '';
	const challengeId =
		challengeOpts && challengeOpts.challengeId != null
			? String(challengeOpts.challengeId).trim()
			: '';
	const cacheKey =
		shareVersion && shareToken
			? `${id}\0${shareVersion}\0${shareToken}\0${challengeId}`
			: challengeId
				? `${id}\0challenge:${challengeId}`
				: id;
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
			const qs = challengeId
				? `?challenge_id=${encodeURIComponent(challengeId)}`
				: '';
			const res = await fetch(`/api/create/images/${encodeURIComponent(id)}${qs}`, {
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
 * @param {object|null|undefined} data - GET /api/create/images/:id JSON
 * @returns {object|null}
 */
function parseChatCreationEmbedMeta(data) {
	const m = data?.meta;
	if (m && typeof m === 'object' && !Array.isArray(m)) return m;
	if (typeof m === 'string' && m) {
		try {
			const o = JSON.parse(m);
			return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
		} catch {
			return null;
		}
	}
	return null;
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
		wrap.innerHTML =
			'<div class="connect-chat-creation-embed-media">' +
			'<div class="connect-chat-creation-embed-inner connect-chat-creation-embed-inner--loading-shell">' +
			'<div class="connect-chat-creation-embed-skeleton connect-chat-creation-embed-skeleton--pending-fill" aria-hidden="true"></div>' +
			'</div></div>';
		a.insertAdjacentElement('afterend', wrap);

		void fetchCreationEmbedPayload(creationId, shareOpts).then((data) => {
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

			const parsedEmbedMeta = parseChatCreationEmbedMeta(data);
			const groupPayload =
				parsedEmbedMeta?.group && typeof parsedEmbedMeta.group === 'object'
					? parsedEmbedMeta.group
					: null;
			const groupSourcesRaw = Array.isArray(groupPayload?.source_creations)
				? groupPayload.source_creations
				: [];
			const creationIdNum = Number(creationId);
			const orderedGroupSources = orderGroupSourcesCoverFirst(
				groupSourcesRaw,
				groupPayload?.cover_source_id
			);
			const groupSourceUrls = orderedGroupSources
				.map((source) => buildGroupEmbedPosterUrl(source, creationIdNum, shareOpts))
				.filter(Boolean);
			const groupVideoSlides = orderedGroupSources
				.map((source) => buildGroupEmbedVideoSlide(source, creationIdNum, shareOpts))
				.filter((slide) => slide && slide.url);
			const isGroupVideoGallery = mediaType === 'video' && groupVideoSlides.length > 1;
			const hasGroupCarouselUi =
				groupPayload?.kind === 'group_creations' && groupSourceUrls.length > 1;
			const hasRenderableMedia =
				Boolean(url) ||
				(mediaType === 'video' && Boolean(videoUrl)) ||
				hasGroupCarouselUi;

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

			if (statusRaw !== 'completed' || !hasRenderableMedia) {
				if (isPending) {
					wrap.classList.add('connect-chat-creation-embed--pending');
					wrap.innerHTML =
						'<div class="connect-chat-creation-embed-media">' +
						'<div class="connect-chat-creation-embed-inner connect-chat-creation-embed-inner--pending">' +
						'<div class="connect-chat-creation-embed-status-message connect-chat-creation-embed-status-message--pending" role="status">Still processing…</div>' +
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

			if (hasGroupCarouselUi) {
				const initialAlt = titleRaw.length > 0 ? escapeHtml(titleRaw) : (isGroupVideoGallery ? 'grouped creation video' : 'grouped creation image');
				const groupCarouselVideoClass = isGroupVideoGallery
					? ' connect-chat-creation-embed-inner--group-video-carousel'
					: '';
				const groupCarouselLabel = isGroupVideoGallery ? 'Open grouped videos' : 'Open grouped images';
				const displayPosterUrls = isGroupVideoGallery ? groupSourceUrls.slice(0, 1) : groupSourceUrls;
				const stackHtml = displayPosterUrls
					.map(
						(src, index) =>
							`<img class="connect-chat-creation-embed-group-img${index === 0 ? ' is-active' : ''}" src="${escapeHtml(src)}" alt="${initialAlt}" loading="eager" decoding="async" data-group-slide-index="${index}" />`
					)
					.join('');
				const groupVideoOverlayHtml = isGroupVideoGallery ? INLINE_CHAT_VIDEO_PLAY_OVERLAY_HTML : '';
				const groupNavHtml = isGroupVideoGallery
					? ''
					: `<button type="button" class="connect-chat-creation-embed-group-nav connect-chat-creation-embed-group-nav--prev" aria-label="Previous grouped image">` +
						`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14.5 6.5L9 12l5.5 5.5" /></svg>` +
						`</button>` +
						`<button type="button" class="connect-chat-creation-embed-group-nav connect-chat-creation-embed-group-nav--next" aria-label="Next grouped image">` +
						`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.5 6.5L15 12l-5.5 5.5" /></svg>` +
						`</button>`;
				wrap.innerHTML =
					`<div class="connect-chat-creation-embed-media">` +
					`<div class="connect-chat-creation-embed-inner connect-chat-creation-embed-inner--group-carousel${groupCarouselVideoClass}${nsfwClass}"${nsfwDataAttr}${isGroupVideoGallery ? ' role="button" tabindex="0" aria-label="' + groupCarouselLabel + '" title="' + groupCarouselLabel + '"' : ''}>` +
					`<div class="connect-chat-creation-embed-group-stack">${stackHtml}</div>` +
					`${groupVideoOverlayHtml}` +
					`${groupNavHtml}` +
					`</div></div>`;
				trimWhitespaceOnlyTextNodes(wrap);
				const innerCarousel = wrap.querySelector('.connect-chat-creation-embed-inner--group-carousel');
				if (innerCarousel instanceof HTMLElement) {
					try {
						innerCarousel.dataset.chatGroupGalleryUrls = JSON.stringify(groupSourceUrls);
					} catch {
						delete innerCarousel.dataset.chatGroupGalleryUrls;
					}
					if (isGroupVideoGallery) {
						try {
							innerCarousel.dataset.chatGroupVideoGallerySlides = JSON.stringify(groupVideoSlides);
						} catch {
							delete innerCarousel.dataset.chatGroupVideoGallerySlides;
						}
					} else {
						delete innerCarousel.dataset.chatGroupVideoGallerySlides;
					}
				}
				const groupImages = Array.from(wrap.querySelectorAll('.connect-chat-creation-embed-group-img'));
				const prevBtn = wrap.querySelector('.connect-chat-creation-embed-group-nav--prev');
				const nextBtn = wrap.querySelector('.connect-chat-creation-embed-group-nav--next');
				const setActiveIndex = (index) => {
					if (groupImages.length === 0) return;
					const next = ((index % groupImages.length) + groupImages.length) % groupImages.length;
					for (let i = 0; i < groupImages.length; i += 1) {
						groupImages[i].classList.toggle('is-active', i === next);
					}
				};
				const getActiveIndex = () => {
					const idx = groupImages.findIndex((img) => img.classList.contains('is-active'));
					return idx >= 0 ? idx : 0;
				};
				if (!isGroupVideoGallery) {
					if (groupImages.length <= 1) {
						if (prevBtn instanceof HTMLButtonElement) prevBtn.hidden = true;
						if (nextBtn instanceof HTMLButtonElement) nextBtn.hidden = true;
					} else {
						if (prevBtn instanceof HTMLButtonElement) {
							prevBtn.addEventListener('click', (e) => {
								e.preventDefault();
								e.stopPropagation();
								setActiveIndex(getActiveIndex() - 1);
							});
						}
						if (nextBtn instanceof HTMLButtonElement) {
							nextBtn.addEventListener('click', (e) => {
								e.preventDefault();
								e.stopPropagation();
								setActiveIndex(getActiveIndex() + 1);
							});
						}
					}
				}
				if (isGroupVideoGallery && innerCarousel instanceof HTMLElement) {
					mountChatEmbedGroupVideoPlaylist(
						innerCarousel,
						groupVideoSlides,
						groupSourceUrls[0] || ''
					);
				} else {
					for (const img of groupImages) {
						if (img instanceof HTMLImageElement) bindChatCreationEmbedMediaLoadError(wrap, img);
					}
				}
				attachChatCreationEmbedDetailLinkReveal(wrap);
				return;
			}

			if (mediaType === 'video' && videoUrl) {
				const posterSrc = url;
				const poster = posterSrc ? ` poster="${escapeHtml(posterSrc)}"` : '';
				/* Inline: paused thumb + play icon; full controls + sound in lightbox. */
				wrap.classList.add('is-loading');
				wrap.innerHTML = `<div class="connect-chat-creation-embed-media"><div class="connect-chat-creation-embed-inner connect-chat-creation-embed-inner--video${nsfwClass}"${nsfwDataAttr} role="button" tabindex="0" aria-label="Open video" title="Open video"><video class="connect-chat-creation-embed-video" playsinline preload="metadata" src="${escapeHtml(videoUrl)}"${poster} data-inline-video-loading="1"></video>${INLINE_CHAT_VIDEO_PLAY_OVERLAY_HTML}</div></div>`;
				trimWhitespaceOnlyTextNodes(wrap);
				const vid = wrap.querySelector('.connect-chat-creation-embed-video');
				if (vid instanceof HTMLVideoElement) {
					bindInlineChatVideoPreviewLoading(wrap, vid);
					bindChatCreationEmbedMediaLoadError(wrap, vid);
				}
				attachChatCreationEmbedDetailLinkReveal(wrap);
				return;
			}

			if (url) {
				const alt =
					titleRaw.length > 0 ? escapeHtml(titleRaw) : 'untitled';
				wrap.innerHTML =
					`<div class="connect-chat-creation-embed-media">` +
					`<div class="connect-chat-creation-embed-inner${nsfwClass}"${nsfwDataAttr}>` +
					`<a href="${escapeHtml(url)}" class="user-link user-text-inline-image-link" aria-label="View full image">` +
					`<img class="connect-chat-creation-embed-img" src="${escapeHtml(url)}" alt="${alt}" width="260" height="260" loading="eager" decoding="async" />` +
					`</a></div></div>`;
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
		}).finally(() => {
			if (wrap.parentNode) scheduleConsecutiveInlineMediaGroupHydrate(wrap);
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
 * - Suno URLs → links with titles and embed player (hydrated asynchronously)
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
export function processUserText(text, options = {}) {
	return textWithCreationLinks(text, options);
}

/**
 * Hydrates all special link types (YouTube, Suno, X) within a container element.
 * Call this after inserting processed user text into the DOM.
 *
 * @param {Element|Document} rootEl - Container element or document to search within
 */
export function hydrateUserTextLinks(rootEl) {
	hydrateYoutubeLinkTitles(rootEl);
	hydrateSunoLinkTitles(rootEl);
	hydrateXLinkTitles(rootEl);
	const imgs = rootEl?.querySelectorAll?.('img.user-text-inline-image');
	if (!imgs || typeof imgs.forEach !== 'function') return;
	imgs.forEach((img) => {
		if (!(img instanceof HTMLImageElement)) return;
		if (img.dataset.inlineImageHydrateBound === '1') return;
		img.dataset.inlineImageHydrateBound = '1';
		const wrap = img.closest('.user-text-inline-image-wrap');
		const done = () => {
			delete img.dataset.inlineImageLoading;
			if (wrap instanceof HTMLElement) {
				wrap.classList.remove('is-loading');
			}
		};
		if (wrap instanceof HTMLElement) {
			wrap.classList.add('is-loading');
		}
		if (img.complete) {
			done();
			return;
		}
		img.addEventListener('load', done, { once: true });
		img.addEventListener('error', done, { once: true });
	});
}

/**
 * Insert a YouTube iframe sibling after each `a[data-youtube-video-id]` link produced by
 * `processUserText`. Idempotent — safe to call repeatedly on the same root.
 *
 * @param {Element|Document} rootEl
 */
export function hydrateYoutubeEmbeds(rootEl) {
	const root =
		rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;

	const links = Array.from(root.querySelectorAll('a[data-youtube-video-id][href]'));
	for (const a of links) {
		if (!(a instanceof HTMLAnchorElement)) continue;
		if (a.dataset.youtubeEmbedHydrated === 'true') continue;
		const videoId = String(a.dataset.youtubeVideoId || '').trim();
		if (!/^[a-zA-Z0-9_-]{6,}$/.test(videoId)) continue;
		a.dataset.youtubeEmbedHydrated = 'true';

		const wrap = document.createElement('div');
		wrap.className = 'connect-chat-youtube-embed';
		const title = a.textContent ? String(a.textContent).trim() : '';
		const safeTitle = title || `youtube ${videoId}`;
		const iframe = document.createElement('iframe');
		iframe.className = 'connect-chat-youtube-embed-iframe';
		iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`;
		iframe.title = safeTitle;
		iframe.setAttribute(
			'allow',
			'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
		);
		iframe.setAttribute('allowfullscreen', '');
		iframe.setAttribute('loading', 'lazy');
		iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
		wrap.appendChild(iframe);
		a.replaceWith(wrap);
	}
}

function mountSunoEmbed(a, songId, titleText) {
	if (!(a instanceof HTMLAnchorElement)) return;
	if (a.dataset.sunoEmbedHydrated === 'true') return;
	if (!songId || !SUNO_UUID_RE.test(songId)) return;
	a.dataset.sunoEmbedHydrated = 'true';
	a.dataset.sunoSongId = songId;

	const wrap = document.createElement('div');
	wrap.className = 'connect-chat-suno-embed';
	const safeTitle = titleText || `suno ${songId.slice(0, 8)}`;
	const iframe = document.createElement('iframe');
	iframe.className = 'connect-chat-suno-embed-iframe';
	iframe.src = `https://suno.com/embed/${encodeURIComponent(songId)}`;
	iframe.title = safeTitle;
	iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen');
	iframe.setAttribute('allowfullscreen', '');
	iframe.setAttribute('loading', 'lazy');
	iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
	wrap.appendChild(iframe);
	a.replaceWith(wrap);
}

/**
 * Insert a Suno iframe sibling after each `a[data-suno-url]` link from `processUserText`.
 * Short `/s/…` links are resolved via `/api/suno/resolve` before embedding.
 *
 * @param {Element|Document} rootEl
 */
export function hydrateSunoEmbeds(rootEl) {
	const root =
		rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;

	const links = Array.from(root.querySelectorAll('a[data-suno-url][href]'));
	for (const a of links) {
		if (!(a instanceof HTMLAnchorElement)) continue;
		if (a.dataset.sunoEmbedHydrated === 'true') continue;

		const url = String(a.dataset.sunoUrl || a.getAttribute('href') || '').trim();
		let songId = String(a.dataset.sunoSongId || '').trim();
		const titleText = a.textContent ? String(a.textContent).trim() : '';

		if (songId && SUNO_UUID_RE.test(songId)) {
			// Reserve the placeholder before swapping so the link text never flashes
			// and the layout height stays fixed across the swap.
			a.dataset.sunoEmbedPending = 'true';
			mountSunoEmbed(a, songId, titleText);
			continue;
		}

		if (!url) continue;
		a.dataset.sunoEmbedPending = 'true';
		void fetchSunoResolve(url).then((payload) => {
			if (!payload?.songId) {
				delete a.dataset.sunoEmbedPending;
				return;
			}
			if (a.dataset.sunoEmbedHydrated === 'true') return;
			const label = formatSunoLabel({
				title: payload.title,
				creator: payload.creator,
				songId: payload.songId,
				slug: a.dataset.sunoSlug || '',
			});
			if (label && a.dataset.sunoTitleHydrated !== 'true') {
				a.textContent = label;
				a.dataset.sunoTitleHydrated = 'true';
			}
			mountSunoEmbed(
				a,
				payload.songId,
				label || titleText || `suno ${payload.songId.slice(0, 8)}`
			);
			delete a.dataset.sunoEmbedPending;
		});
	}
}

/**
 * Bind load-error handling on pasted generic video embeds (no creation id).
 *
 * @param {Element|Document} rootEl
 */
function bindInlineChatVideoPreviewLoading(embed, video) {
	if (!(embed instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) return;
	if (video.dataset.inlineVideoHydrateBound === '1') return;
	video.dataset.inlineVideoHydrateBound = '1';
	primeMediaElementForAudioLeveling(video);

	const reveal = () => {
		delete video.dataset.inlineVideoLoading;
		embed.classList.remove('is-loading');
		if (video.videoWidth > 0 && video.videoHeight > 0) {
			video.dataset.inlineVideoWidth = String(video.videoWidth);
			video.dataset.inlineVideoHeight = String(video.videoHeight);
		}
	};

	const tryReveal = () => {
		if (video.error) return;
		if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
			reveal();
		}
	};

	if (video.dataset.inlineVideoLoading === '1') {
		embed.classList.add('is-loading');
	} else {
		tryReveal();
	}

	video.addEventListener('loadeddata', tryReveal, { once: true });
	video.addEventListener('loadedmetadata', tryReveal, { once: true });
	tryReveal();
}

function hydrateInlineGenericVideoEmbeds(rootEl) {
	const root =
		rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;
	for (const embed of root.querySelectorAll('[data-generic-video-embed="1"]')) {
		if (!(embed instanceof HTMLElement)) continue;
		if (embed.dataset.genericVideoHydrated === '1') continue;
		embed.dataset.genericVideoHydrated = '1';
		const vid = embed.querySelector('.connect-chat-creation-embed-video');
		if (vid instanceof HTMLVideoElement) {
			bindInlineChatVideoPreviewLoading(embed, vid);
			bindChatCreationEmbedMediaLoadError(embed, vid);
		}
	}
}

function hydrateInlineChatCreationVideoEmbeds(rootEl) {
	const root =
		rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;
	for (const embed of root.querySelectorAll(
		'.connect-chat-creation-embed[data-creation-id] .connect-chat-creation-embed-inner--video'
	)) {
		const inner = embed;
		const wrap = inner.closest('.connect-chat-creation-embed');
		const vid = inner.querySelector('.connect-chat-creation-embed-video');
		if (!(wrap instanceof HTMLElement) || !(vid instanceof HTMLVideoElement)) continue;
		bindInlineChatVideoPreviewLoading(wrap, vid);
	}
}

/**
 * Inline videos (`video[data-inline-click-controls="1"]`) start without controls so the bubble
 * stays compact; first user click reveals controls and starts playback. Idempotent.
 *
 * @param {Element|Document} rootEl
 */
export function bindInlineVideoClickControls(rootEl) {
	const root =
		rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;
	for (const video of root.querySelectorAll('video[data-inline-click-controls="1"]')) {
		if (!(video instanceof HTMLVideoElement)) continue;
		if (video.dataset.clickControlsBound === '1') continue;
		video.dataset.clickControlsBound = '1';
		video.controls = false;
		const wrap = video.closest('.connect-chat-creation-embed-inner--video');
		const overlay = wrap?.querySelector?.('.user-text-inline-video-play-overlay');
		const activate = () => {
			video.controls = true;
			if (wrap instanceof HTMLElement) wrap.classList.add('user-text-inline-video--active');
			if (overlay instanceof HTMLButtonElement) overlay.hidden = true;
			attachMediaAudioLeveling(video);
			void video.play().catch(() => {
				// ignore autoplay/gesture issues; controls are now visible.
			});
		};
		if (overlay instanceof HTMLButtonElement) {
			overlay.addEventListener('click', () => activate());
		}
		video.addEventListener('click', () => {
			if (video.controls) return;
			activate();
		});
	}
}

function isWhitespaceOnlyInlineMediaGap(node) {
	return node.nodeType === Node.TEXT_NODE && /^\s*$/.test(node.textContent || '');
}

const INLINE_MEDIA_GROUP_MIN_ITEMS = 4;

function isUngroupedInlineMediaGroupMember(el) {
	return el instanceof HTMLElement && !el.closest('.user-text-inline-media-group');
}

function isGroupableInlineImageWrap(el) {
	return (
		isUngroupedInlineMediaGroupMember(el) && el.classList.contains('user-text-inline-image-wrap')
	);
}

function isGroupableChatCreationEmbed(el) {
	if (!isUngroupedInlineMediaGroupMember(el)) return false;
	if (!el.classList.contains('connect-chat-creation-embed')) return false;
	if (el.classList.contains('connect-chat-creation-embed--error')) return false;
	if (el.querySelector('.connect-chat-creation-embed-inner--group-carousel')) return false;
	if (el.querySelector('[data-generic-video-embed]')) return false;
	return true;
}

function isInlineMediaGroupUnit(el) {
	return isGroupableInlineImageWrap(el) || isGroupableChatCreationEmbed(el);
}

/** @param {HTMLElement} unit */
function domNodesForInlineMediaGroupUnit(unit) {
	if (isGroupableChatCreationEmbed(unit)) {
		const nodes = [];
		let prev = unit.previousSibling;
		while (prev && isWhitespaceOnlyInlineMediaGap(prev)) prev = prev.previousSibling;
		if (
			prev instanceof HTMLAnchorElement &&
			prev.classList.contains('connect-chat-creation-embed-paired-link')
		) {
			nodes.push(prev);
		}
		nodes.push(unit);
		return nodes;
	}
	return [unit];
}

/**
 * @param {Node[]} nodes
 * @param {number} startIdx
 * @returns {{ nextIdx: number, paragraphBreak: boolean }}
 */
function skipInlineMediaGroupGaps(nodes, startIdx) {
	let i = startIdx;
	let brCount = 0;
	while (i < nodes.length) {
		const node = nodes[i];
		if (isWhitespaceOnlyInlineMediaGap(node)) {
			i += 1;
			continue;
		}
		if (node instanceof HTMLBRElement) {
			brCount += 1;
			if (brCount >= 2) return { nextIdx: i, paragraphBreak: true };
			i += 1;
			continue;
		}
		break;
	}
	return { nextIdx: i, paragraphBreak: false };
}

function stripBridgesBetweenUnits(container, units) {
	for (let u = 0; u < units.length - 1; u += 1) {
		const lastNodes = domNodesForInlineMediaGroupUnit(units[u]);
		const firstNodes = domNodesForInlineMediaGroupUnit(units[u + 1]);
		const endNode = lastNodes[lastNodes.length - 1];
		const startNode = firstNodes[0];
		if (!endNode?.parentNode || !startNode) continue;
		let n = endNode.nextSibling;
		while (n && n !== startNode) {
			const next = n.nextSibling;
			if (n instanceof HTMLBRElement || isWhitespaceOnlyInlineMediaGap(n)) {
				container.removeChild(n);
			}
			n = next;
		}
	}
}

function mountInlineMediaGroup(container, units) {
	if (units.length < INLINE_MEDIA_GROUP_MIN_ITEMS) return;
	stripBridgesBetweenUnits(container, units);
	const firstDomNodes = domNodesForInlineMediaGroupUnit(units[0]);
	const anchor = firstDomNodes[0];
	if (!(anchor instanceof Node) || !anchor.parentNode) return;

	const group = document.createElement('div');
	group.className = 'user-text-inline-media-group';
	group.dataset.inlineImageGroup = '1';
	container.insertBefore(group, anchor);
	for (const unit of units) {
		for (const node of domNodesForInlineMediaGroupUnit(unit)) {
			group.appendChild(node);
		}
	}

	const countEl = document.createElement('span');
	countEl.className = 'user-text-inline-media-group-count';
	countEl.setAttribute('aria-hidden', 'true');
	countEl.textContent = String(units.length);
	group.appendChild(countEl);

	const firstLink = group.querySelector('a.user-text-inline-image-link');
	if (firstLink instanceof HTMLAnchorElement) {
		firstLink.setAttribute('aria-label', `View media (${units.length})`);
	}
	const firstVideoInner = group.querySelector('.connect-chat-creation-embed-inner--video');
	if (firstVideoInner instanceof HTMLElement) {
		firstVideoInner.setAttribute('aria-label', `View videos (${units.length})`);
		firstVideoInner.setAttribute('title', `View videos (${units.length})`);
	}
}

/**
 * Gallery metadata for a grouped inline-media bubble slot.
 *
 * @param {HTMLElement} groupEl
 * @param {HTMLAnchorElement | null} [clickedLink]
 * @param {HTMLElement | null} [clickedEmbed]
 * @returns {{
 *   slides: Array<{
 *     kind: 'image' | 'video',
 *     url: string,
 *     creationId: string,
 *     sourceImg?: HTMLImageElement,
 *     sourceVideo?: HTMLVideoElement,
 *     posterUrl?: string,
 *   }>,
 *   galleryUrls: string[],
 *   galleryImgs: HTMLImageElement[],
 *   galleryIndex: number,
 *   creationId: string,
 *   videoSlides: Array<{ url: string, creationId: string }>,
 * }}
 */
export function collectInlineMediaGroupGallery(groupEl, clickedLink = null, clickedEmbed = null) {
	const out = {
		slides: [],
		galleryUrls: [],
		galleryImgs: [],
		galleryIndex: 0,
		creationId: '',
		videoSlides: [],
	};
	if (!(groupEl instanceof HTMLElement)) return out;

	const pushImageSlide = (url, creationId, sourceImg) => {
		const src = String(url || '').trim();
		if (!src) return;
		const cid = String(creationId || '').trim();
		out.slides.push({
			kind: 'image',
			url: src,
			creationId: cid,
			...(sourceImg instanceof HTMLImageElement ? { sourceImg } : {}),
		});
		out.galleryImgs.push(sourceImg instanceof HTMLImageElement ? sourceImg : null);
		out.galleryUrls.push(src);
	};

	const pushVideoSlide = (url, creationId, sourceVideo, posterUrl) => {
		const src = String(url || '').trim();
		if (!src) return;
		const cid = String(creationId || '').trim();
		out.slides.push({
			kind: 'video',
			url: src,
			creationId: cid,
			...(sourceVideo instanceof HTMLVideoElement ? { sourceVideo } : {}),
			...(posterUrl ? { posterUrl: String(posterUrl).trim() } : {}),
		});
		out.videoSlides.push({ url: src, creationId: cid });
	};

	for (const child of groupEl.children) {
		if (!(child instanceof HTMLElement)) continue;
		if (child.classList.contains('user-text-inline-media-group-count')) continue;
		if (child.classList.contains('connect-chat-creation-embed-paired-link')) continue;

		if (child.classList.contains('user-text-inline-image-wrap')) {
			const img = child.querySelector('img.user-text-inline-image');
			if (!(img instanceof HTMLImageElement)) continue;
			pushImageSlide(
				img.currentSrc || img.getAttribute('src') || '',
				'',
				img
			);
			continue;
		}

		if (!child.classList.contains('connect-chat-creation-embed')) continue;

		const creationId = String(child.getAttribute('data-creation-id') || '').trim();
		const vid = child.querySelector('video.connect-chat-creation-embed-video');
		if (vid instanceof HTMLVideoElement) {
			pushVideoSlide(
				vid.currentSrc || vid.getAttribute('src') || '',
				creationId,
				vid,
				vid.getAttribute('poster') || ''
			);
			continue;
		}
		const img = child.querySelector('img.connect-chat-creation-embed-img');
		if (img instanceof HTMLImageElement) {
			pushImageSlide(img.currentSrc || img.getAttribute('src') || '', creationId, img);
		}
	}

	out.galleryUrls = out.galleryUrls.filter(Boolean);
	out.galleryImgs = out.galleryImgs.filter((img) => img instanceof HTMLImageElement);

	const slideIndexForEmbed = (embed) => {
		if (!(embed instanceof HTMLElement)) return -1;
		const cid = String(embed.getAttribute('data-creation-id') || '').trim();
		const video = embed.querySelector('video.connect-chat-creation-embed-video');
		if (video instanceof HTMLVideoElement) {
			const url = String(video.currentSrc || video.getAttribute('src') || '').trim();
			return out.slides.findIndex(
				(slide) =>
					slide.kind === 'video' &&
					slide.url === url &&
					(!cid || slide.creationId === cid)
			);
		}
		const image = embed.querySelector('img.connect-chat-creation-embed-img');
		if (image instanceof HTMLImageElement) {
			const url = String(image.currentSrc || image.getAttribute('src') || '').trim();
			return out.slides.findIndex(
				(slide) =>
					slide.kind === 'image' &&
					slide.url === url &&
					(!cid || slide.creationId === cid)
			);
		}
		return -1;
	};

	if (clickedEmbed instanceof HTMLElement) {
		const idx = slideIndexForEmbed(clickedEmbed);
		if (idx >= 0) out.galleryIndex = idx;
		out.creationId = String(clickedEmbed.getAttribute('data-creation-id') || '').trim();
	} else if (clickedLink instanceof HTMLAnchorElement) {
		const embedWrap = clickedLink.closest('.connect-chat-creation-embed');
		if (embedWrap instanceof HTMLElement) {
			const idx = slideIndexForEmbed(embedWrap);
			if (idx >= 0) out.galleryIndex = idx;
			out.creationId = String(embedWrap.getAttribute('data-creation-id') || '').trim();
		} else {
			const thumb = clickedLink.querySelector('img.user-text-inline-image');
			if (thumb instanceof HTMLImageElement) {
				const url = String(thumb.currentSrc || thumb.getAttribute('src') || '').trim();
				const idx = out.slides.findIndex((slide) => slide.kind === 'image' && slide.url === url);
				if (idx >= 0) out.galleryIndex = idx;
			}
		}
	}

	return out;
}

function resolveInlineMediaGroupUnitAt(nodes, i) {
	const node = nodes[i];
	if (node instanceof HTMLElement && isInlineMediaGroupUnit(node)) {
		return { unit: node, nextIdx: i + 1 };
	}
	if (
		node instanceof HTMLAnchorElement &&
		node.classList.contains('connect-chat-creation-embed-paired-link')
	) {
		let j = i + 1;
		while (j < nodes.length && isWhitespaceOnlyInlineMediaGap(nodes[j])) j += 1;
		const maybe = nodes[j];
		if (maybe instanceof HTMLElement && isGroupableChatCreationEmbed(maybe)) {
			return { unit: maybe, nextIdx: j + 1 };
		}
	}
	return null;
}

function scheduleConsecutiveInlineMediaGroupHydrate(wrap) {
	const host =
		wrap?.closest?.('.connect-chat-msg-bubble') ||
		wrap?.closest?.('.comment-text') ||
		wrap?.closest?.('.chat-page-canvas-body-view');
	if (host instanceof HTMLElement) hydrateConsecutiveInlineImageGroups(host);
}

/**
 * Collapse consecutive inline media (uploaded images, share links, /creations URLs) into one slot.
 * Lightbox prev/next is wired via `bindChatInlineImageLightboxClickDelegation`.
 *
 * @param {Element|Document} rootEl
 */
export function hydrateConsecutiveInlineImageGroups(rootEl) {
	const root =
		rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;

	const containers = new Set();
	for (const el of root.querySelectorAll(
		'.user-text-inline-image-wrap, .connect-chat-creation-embed'
	)) {
		if (el.closest('.user-text-inline-media-group')) continue;
		const parent = el.parentElement;
		if (parent) containers.add(parent);
	}

	for (const container of containers) {
		const nodes = Array.from(container.childNodes);
		const runs = [];
		let run = [];
		let i = 0;
		while (i < nodes.length) {
			const gap = skipInlineMediaGroupGaps(nodes, i);
			if (gap.paragraphBreak && run.length > 0) {
				if (run.length >= INLINE_MEDIA_GROUP_MIN_ITEMS) runs.push(run);
				run = [];
			}
			i = gap.nextIdx;
			if (i >= nodes.length) break;

			const resolved = resolveInlineMediaGroupUnitAt(nodes, i);
			if (resolved) {
				run.push(resolved.unit);
				i = resolved.nextIdx;
				continue;
			}
			if (run.length >= INLINE_MEDIA_GROUP_MIN_ITEMS) runs.push(run);
			run = [];
			i += 1;
		}
		if (run.length >= INLINE_MEDIA_GROUP_MIN_ITEMS) runs.push(run);

		for (const units of runs) {
			mountInlineMediaGroup(container, units);
		}
		trimBridgesTrailingMediaGroup(container);
	}
}

function trimBridgesTrailingMediaGroup(container) {
	if (!(container instanceof HTMLElement)) return;
	for (const group of container.querySelectorAll('.user-text-inline-media-group')) {
		let n = group.nextSibling;
		while (n instanceof HTMLBRElement) {
			const rm = n;
			n = n.nextSibling;
			container.removeChild(rm);
		}
	}
}

/**
 * Full hydration pass for any container that renders user text via `processUserText`:
 * link titles + inline image loading + YouTube iframes + creation/share-link card embeds +
 * generic upload video embeds. Use this anywhere you want chat-style rich rendering
 * (chat messages, comments, etc.).
 *
 * @param {Element|Document} rootEl
 */
export function hydrateRichUserTextEmbeds(rootEl) {
	hydrateUserTextLinks(rootEl);
	hydrateYoutubeEmbeds(rootEl);
	hydrateSunoEmbeds(rootEl);
	hydrateChatCreationEmbeds(rootEl);
	hydrateInlineGenericVideoEmbeds(rootEl);
	hydrateInlineChatCreationVideoEmbeds(rootEl);
	bindInlineVideoClickControls(rootEl);
	hydrateConsecutiveInlineImageGroups(rootEl);
}
