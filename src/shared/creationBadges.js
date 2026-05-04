/**
 * Shared HTML for creation card overlay badges (published, user-deleted).
 * Use with .creation-published-badge and .creation-user-deleted-badge (styles in global.css).
 */

import * as SvgIcons from '/icons/svg-strings.js';

const html = String.raw;

/** Inline trophy if dynamic/cache-split imports ever omit {@link SvgIcons.trophyIcon} (matches lucide outline trophy). */
function trophyIconMarkupFallback() {
	return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true" data-from="creation-badges-fallback">
		<path d="M8 21h8"></path>
		<path d="M12 17v4"></path>
		<path d="M7 4h10v5a5 5 0 0 1-10 0V4z"></path>
		<path d="M7 8H5a2 2 0 0 1-2-2V5h4"></path>
		<path d="M17 8h2a2 2 0 0 0 2-2V5h-4"></path>
	</svg>`;
}

/** Published (globe) badge for creation cards. */
export function publishedBadgeHtml() {
	const g = SvgIcons.globeIcon;
	const inner = typeof g === 'function' ? g() : '';
	return html`<div class="creation-published-badge" title="Published">${inner}</div>`;
}

/** Centered trophy on blurred thumbnails for creations entered in a challenge. */
export function challengeEnteredBadgeHtml() {
	const t = SvgIcons.trophyIcon;
	const inner = typeof t === 'function' ? t() : trophyIconMarkupFallback();
	return html`<span class="creation-challenge-entered-badge" role="img" aria-label="Entered in challenge" title="Entered in challenge">${inner}</span>`;
}

/** User-deleted (trash) badge for creation cards (e.g. admin view). */
export function userDeletedBadgeHtml() {
	return html`<div class="creation-user-deleted-badge" title="User deleted this creation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></div>`;
}
