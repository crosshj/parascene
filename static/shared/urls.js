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
 * Matches full URLs that point to a creation page (e.g. https://parascene.crosshj.com/creations/219).
 * Captures the creation ID for the replacement path.
 */
const CREATION_URL_RE = /https?:\/\/[^\s"'<>]+\/creations\/(\d+)\/?/g;

/**
 * Turns plain text into HTML that is safe to insert and converts full creation URLs
 * (e.g. https://parascene.crosshj.com/creations/219) into relative links that display
 * as /creations/219 and navigate to that creation page.
 *
 * Use when rendering user content such as image descriptions or comments.
 *
 * @param {string} text - Raw user text (may contain URLs and special characters)
 * @returns {string} - HTML-safe string with creation URLs as <a href="/creations/123">/creations/123</a>
 */
export function textWithCreationLinks(text) {
	const escaped = escapeHtml(text);
	return escaped.replace(CREATION_URL_RE, (_, id) => {
		const path = `/creations/${id}`;
		return `<a href="${path}" class="user-link creation-link">${path}</a>`;
	});
}
