/**
 * Shared HTML for creation card overlay badges (published, user-deleted).
 * Use with .creation-published-badge and .creation-user-deleted-badge (styles in global.css).
 */

import { globeIcon } from '../icons/svg-strings.js';

const html = String.raw;

/** Published (globe) badge for creation cards. */
export function publishedBadgeHtml() {
	return html`<div class="creation-published-badge" title="Published">${globeIcon()}</div>`;
}

/** User-deleted (trash) badge for creation cards (e.g. admin view). */
export function userDeletedBadgeHtml() {
	return html`<div class="creation-user-deleted-badge" title="User deleted this creation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></div>`;
}
