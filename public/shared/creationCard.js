/**
 * Shared creation card shell: .route-card.route-card-image with .route-media, optional badges, .route-details.
 * Callers supply details content and handle click/observers. Used by explore, creations, creation-detail, user-profile.
 */

import { challengeEnteredBadgeHtml } from './creationBadges.js';

const html = String.raw;

function escapeAttr(v) {
	if (v == null) return '';
	const s = String(v);
	return s
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/**
 * Build the HTML string for one creation card shell.
 * @param {{
 *   mediaAttrs?: Record<string, string | boolean>,
 *   badgesHtml?: string,
 *   detailsContentHtml?: string,
 *   bulkOverlayHtml?: string,
 *   nsfw?: boolean,
 *   challengeGridBlur?: boolean
 * }} options
 * @returns {string}
 */
export function buildCreationCardShell(options) {
	const {
		mediaAttrs = {},
		badgesHtml = '',
		detailsContentHtml = '',
		bulkOverlayHtml = '',
		nsfw = false,
		challengeGridBlur = false,
	} = options;

	const attrs = Object.entries(mediaAttrs)
		.filter(([, v]) => v != null && v !== '')
		.map(([k, v]) => (v === true ? k : `${k}="${escapeAttr(v)}"`))
		.join(' ');
	const mediaClass =
		'route-media' +
		(nsfw ? ' nsfw' : '') +
		(challengeGridBlur && !nsfw ? ' route-media--challenge-pending' : '');
	const blurOverlay =
		challengeGridBlur && !nsfw
			? html`<span class="route-media-challenge-blur-overlay" aria-hidden="true"></span>${challengeEnteredBadgeHtml()}`
			: '';
	const mediaTag = html`<div class="${mediaClass}" aria-hidden="true"${attrs ? ' ' + attrs : ''}>${blurOverlay}</div>`;
	const detailsBlock =
		typeof detailsContentHtml === 'string' && detailsContentHtml.trim()
			? html`<div class="route-details">
	<div class="route-details-content">
${detailsContentHtml}
	</div>
</div>`
			: '';

	return html`<div class="route-card route-card-image">
${mediaTag}
${badgesHtml}
${detailsBlock}
${bulkOverlayHtml}
</div>`;
}
