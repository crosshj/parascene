/** Max single-line plaintext preview length for reply bars (ellipsis outside). */
export const DEFAULT_REPLY_PREVIEW_MAX_CHARS = 220;

function collapseWhitespace(text) {
	return String(text ?? '')
		.replace(/\u0000/g, '')
		.replace(/\r\n/g, '\n')
		.replace(/[\t\f\v]+/g, ' ')
		.replace(/ *\n+/g, ' ')
		.replace(/ {2,}/g, ' ')
		.trim();
}

/**
 * Drop URL-like fragments for a muted preview (no embeds / markdown / markup).
 */
function stripUrlLikeSegments(text) {
	let s = String(text ?? '');
	const urlLike =
		/\b(https?:\/\/[^\s<>()]+)|(www\.[^\s<>()]+\.[a-z]{2,}[^\s<>()]*)|(\/api\/[^\s<>()]+)|(\/[^\s<>()]+\.(?:png|jpe?g|gif|webp|avif|svg|mp4|webm|mov)(?:\?[^\s<>()]*)?)/gi;
	s = s.replace(urlLike, '').replace(/\(\s*\)/g, '');
	return collapseWhitespace(s);
}

/** Strip markdown-ish line noise for preview only — conservative, lossy. */
function stripStructuralMarkdownLight(text) {
	let s = String(text ?? '').replace(/^#{1,6}\s+/gm, '').replace(/^>\s?/gm, '');
	s = s.replace(/`{1,3}[^`]*`{1,3}/g, ' ');
	s = s.replace(/\[(.*?)\]\([^)]*\)/g, '$1');
	return collapseWhitespace(s);
}

/**
 * Build a safe one-line plaintext preview for reply annotations (no rich embeds).
 * @param {string} rawBody
 * @param {number} [maxLen]
 * @returns {string}
 */
export function plainTextReplyPreview(rawBody, maxLen = DEFAULT_REPLY_PREVIEW_MAX_CHARS) {
	let s = stripStructuralMarkdownLight(stripUrlLikeSegments(String(rawBody ?? '')));
	if (!s) return '';
	const cap = Math.max(16, Math.min(500, Number(maxLen) || DEFAULT_REPLY_PREVIEW_MAX_CHARS));
	if (s.length <= cap) return s;
	return `${s.slice(0, cap - 1)}…`;
}
