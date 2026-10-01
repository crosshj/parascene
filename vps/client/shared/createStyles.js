/** VPS copy of the style thumbnail URL helper used by chat suggestion cards. */
export const STYLE_THUMB_BASE = '/assets/style-thumbs';

export function getStyleThumbUrl(key) {
	const value = String(key || '').trim();
	if (!value || value === 'none') return '';
	return `${STYLE_THUMB_BASE}/${value}.webp`;
}
