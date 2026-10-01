/**
 * Vote-modal helpers for dropping submissions whose creation cannot be loaded.
 */

/**
 * True when the vote modal should drop this slide instead of showing a load error.
 * @param {object | null | undefined} c
 */
export function shouldSkipVoteSlideForCreation(c) {
	if (!c || c._error) return true;
	const mediaType = typeof c.media_type === 'string' ? c.media_type.trim().toLowerCase() : 'image';
	const videoUrl = typeof c.video_url === 'string' ? c.video_url.trim() : '';
	const url = typeof c.url === 'string' ? c.url.trim() : '';
	const thumb = typeof c.thumbnail_url === 'string' ? c.thumbnail_url.trim() : '';
	if (mediaType === 'audio') return false;
	if (mediaType === 'video') return !videoUrl && !url && !thumb;
	return !url && !thumb;
}

/**
 * Remove a missing/unloadable vote slide and keep the current index in range.
 * @param {object[]} slides
 * @param {number} index
 * @returns {{ slides: object[], index: number }}
 */
export function dropMissingVoteSlide(slides, index) {
	const list = Array.isArray(slides) ? slides.slice() : [];
	const i = Number(index);
	if (!Number.isFinite(i) || i < 0 || i >= list.length) {
		return { slides: list, index: 0 };
	}
	list.splice(i, 1);
	let nextIndex = i;
	if (nextIndex >= list.length) nextIndex = Math.max(0, list.length - 1);
	return { slides: list, index: nextIndex };
}
