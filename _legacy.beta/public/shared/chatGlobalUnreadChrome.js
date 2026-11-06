/**
 * Tab chrome for global chat unread: document title `(n) …` prefix + favicon swap.
 * Used by `app-navigation` and standalone `chat.js` (same rules, one implementation).
 */

export const CHAT_UNREAD_TITLE_PREFIX_RE = /^\((?:99\+|\d+)\)\s+/;

export const CHAT_UNREAD_FAVICON_HREF = '/favicon-unread.svg';

let cachedDefaultFaviconHref = null;

function resolveDefaultFaviconHref() {
	if (cachedDefaultFaviconHref) return cachedDefaultFaviconHref;
	const link = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
	let raw = (link?.getAttribute('href') || '').trim();
	if (!raw || raw.includes('favicon-unread')) {
		raw = '/favicon.svg';
	}
	try {
		const u = new URL(raw, window.location.href);
		cachedDefaultFaviconHref = u.pathname || '/favicon.svg';
	} catch {
		cachedDefaultFaviconHref = '/favicon.svg';
	}
	return cachedDefaultFaviconHref;
}

/**
 * @param {number} totalUnread — `GET /api/chat/unread-summary` `total_unread`
 */
export function applyChatGlobalUnreadChrome(totalUnread) {
	if (typeof document === 'undefined') return;
	const n = Number(totalUnread);
	const count = Number.isFinite(n) && n > 0 ? Math.max(0, Math.floor(n)) : 0;

	const cur = String(document.title || '').replace(CHAT_UNREAD_TITLE_PREFIX_RE, '').trim();
	if (count > 0) {
		const label = count > 99 ? '99+' : String(count);
		document.title = `(${label}) ${cur || 'parascene'}`;
	} else {
		document.title = cur || 'parascene';
	}

	const link = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
	if (!link) return;
	const defaultHref = resolveDefaultFaviconHref();
	const next = count > 0 ? CHAT_UNREAD_FAVICON_HREF : defaultHref;
	const curPath = (link.getAttribute('href') || '').trim().split('?')[0];
	if (curPath !== next) {
		link.setAttribute('href', next);
	}
}

/** Reset `<link rel="icon" …>` to the default favicon href (e.g. on shell teardown / pagehide). */
export function restoreChatGlobalUnreadFavicon() {
	const link = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
	if (!link) return;
	const h = cachedDefaultFaviconHref || resolveDefaultFaviconHref();
	link.setAttribute('href', h);
}
