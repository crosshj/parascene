/**
 * HTMLMediaElement.play() rejects with AbortError when interrupted by pause() or DOM removal.
 * Swallow expected rejections so they do not appear as uncaught promise errors in devtools.
 *
 * @param {HTMLMediaElement | null | undefined} media
 * @returns {Promise<void> | undefined}
 */
export function safeMediaPlay(media) {
	if (!(media instanceof HTMLMediaElement)) return undefined;
	try {
		const p = media.play();
		if (p != null && typeof p.catch === 'function') {
			p.catch(() => {});
		}
		return p;
	} catch {
		return undefined;
	}
}
