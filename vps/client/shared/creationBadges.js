/**
 * Shared HTML for creation card overlay badges (published, user-deleted).
 * Use with .creation-published-badge and .creation-user-deleted-badge (styles in global.css).
 */

import * as SvgIcons from '../icons/svg-strings.js';

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

/** Music / audio creation badge (cover-only cards — never an iframe). */
export function musicBadgeHtml() {
	const m = SvgIcons.audioClipMusicIcon;
	const inner = typeof m === 'function' ? m() : '';
	return html`<div class="creation-music-badge" title="Music" role="img" aria-label="Music">${inner}</div>`;
}

/** Imported YouTube / embed video badge (cover-only — never an iframe in feed). */
export function videoImportBadgeHtml() {
	return html`<div class="creation-music-badge creation-video-import-badge" title="Video" role="img" aria-label="Video"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg></div>`;
}

/** Centered trophy on blurred thumbnails for creations entered in a challenge. */
export function challengeEnteredBadgeHtml() {
	const t = SvgIcons.trophyIcon;
	const inner = typeof t === 'function' ? t() : trophyIconMarkupFallback();
	return html`<span class="creation-challenge-entered-badge" role="img" aria-label="Entered in challenge" title="Entered in challenge">${inner}</span>`;
}

/**
 * Corner trophy badge (same placement language as published globe).
 * Use whenever a creation is locked to a challenge (entry, pin, or organizer media).
 */
export function challengeLockedBadgeHtml(title = 'Locked to a challenge') {
	const t = SvgIcons.trophyIcon;
	const inner = typeof t === 'function' ? t() : trophyIconMarkupFallback();
	const label = typeof title === 'string' && title.trim() ? title.trim() : 'Locked to a challenge';
	return html`<div class="creation-challenge-locked-badge" title="${label}" role="img" aria-label="${label}">${inner}</div>`;
}

/** User-deleted (trash) badge for creation cards (e.g. admin view). */
export function userDeletedBadgeHtml() {
	return html`<div class="creation-user-deleted-badge" title="User deleted this creation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></div>`;
}
