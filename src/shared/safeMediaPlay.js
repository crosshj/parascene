/**
 * HTMLMediaElement.play() rejects with AbortError when interrupted by pause() or DOM removal.
 * Swallow expected rejections so they do not appear as uncaught promise errors in devtools.
 */

/** @param {unknown} err */
export function isMediaPlayAbortError(err) {
	return err != null && typeof err === 'object' && /** @type {{ name?: string }} */ (err).name === 'AbortError';
}

/** @param {unknown} err — autoplay policy blocked (not scroll/pause interrupt). */
export function isMediaAutoplayBlockedError(err) {
	return err != null && typeof err === 'object' && /** @type {{ name?: string }} */ (err).name === 'NotAllowedError';
}

/**
 * @param {HTMLMediaElement | null | undefined} media
 * @returns {Promise<void> | undefined}
 */
export function safeMediaPlay(media) {
	if (!(media instanceof HTMLMediaElement)) return undefined;
	try {
		const p = media.play();
		if (p != null && typeof p.catch === 'function') {
			p.catch((err) => {
				if (!isMediaPlayAbortError(err)) {
					// ignore other expected failures (autoplay policy, etc.)
				}
			});
		}
		return p;
	} catch {
		return undefined;
	}
}

/**
 * play() with onPlayed; AbortError swallowed; other rejections passed to onRejected.
 *
 * @param {HTMLMediaElement | null | undefined} media
 * @param {{ onPlayed?: () => void, onRejected?: (err: unknown) => void }} [opts]
 */
export function safeMediaPlayWithHandlers(media, opts = {}) {
	if (!(media instanceof HTMLMediaElement)) return;
	try {
		const p = media.play();
		if (p == null || typeof p.then !== 'function') return;
		void p
			.then(() => {
				opts.onPlayed?.();
			})
			.catch((err) => {
				if (isMediaPlayAbortError(err)) return;
				opts.onRejected?.(err);
			});
	} catch {
		// ignore sync throw
	}
}
