/**
 * YouTube in doom scroll: full-bleed width; height limited to the band between
 * the topbar and the username row. Horizontal fit is left to the YouTube player.
 */

/** Breathing room between the player and the username row. */
export const DOOM_YOUTUBE_CHROME_GAP_PX = 8;

/**
 * @typedef {{ top: number, bottom: number }} DoomYoutubeFrameInsets
 */

/**
 * Vertical insets for a full-width YouTube frame. `bottom` is distance from the wrap bottom.
 *
 * @param {number} wrapH
 * @param {{ topInset?: number, bottomInset?: number }} [insets]
 * @returns {DoomYoutubeFrameInsets | null}
 */
export function doomYoutubeFrameInsets(wrapH, insets = {}) {
	if (!Number.isFinite(wrapH) || wrapH <= 0) return null;
	const top = Math.max(0, Number(insets.topInset) || 0);
	const bottom = Math.max(0, Number(insets.bottomInset) || 0);
	if (top + bottom >= wrapH) return null;
	return { top, bottom };
}

/**
 * @param {DoomYoutubeFrameInsets} insets
 * @returns {string}
 */
export function doomYoutubeFrameCssText(insets) {
	return [
		'position:absolute',
		'left:0',
		'right:0',
		'width:100%',
		`top:${insets.top}px`,
		`bottom:${insets.bottom}px`,
		'height:auto',
		'overflow:hidden',
		'transform:none'
	].join(';');
}
