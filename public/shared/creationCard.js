/**
 * Shared creation card shell: .route-card.route-card-image with .route-media, optional badges, .route-details.
 * Callers supply details content and handle click/observers. Used by explore, creations, creation-detail, user-profile.
 */

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
 *   mediaAttrs?: Record<string, string>,
 *   mediaContent?: string,
 *   badgesHtml?: string,
 *   detailsContentHtml: string,
 *   bulkOverlayHtml?: string
 * }} options
 * @returns {string}
 */
export function buildCreationCardShell(options) {
	const {
		mediaAttrs = {},
		mediaContent = '',
		badgesHtml = '',
		detailsContentHtml,
		bulkOverlayHtml = '',
	} = options;

	const attrs = Object.entries(mediaAttrs)
		.filter(([, v]) => v != null && v !== '')
		.map(([k, v]) => (v === true ? k : `${k}="${escapeAttr(v)}"`))
		.join(' ');
	const mediaTag = html`<div class="route-media" aria-hidden="true"${attrs ? ' ' + attrs : ''}>${mediaContent}</div>`;

	return html`<div class="route-card route-card-image">
${mediaTag}
${badgesHtml}
<div class="route-details">
	<div class="route-details-content">
${detailsContentHtml}
	</div>
</div>
${bulkOverlayHtml}
</div>`;
}
