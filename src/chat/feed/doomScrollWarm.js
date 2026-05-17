/**
 * Two-stage off-screen doom video warm-up (metadata → auto on swipe / visibility).
 */

/** @typedef {'metadata' | 'auto'} DoomVideoWarmLevel */

/**
 * Skip full-buffer warm-up on save-data / very slow connections.
 * @returns {boolean}
 */
export function shouldSkipAggressiveVideoWarm() {
	try {
		const conn = navigator.connection;
		if (conn?.saveData) return true;
		const t = typeof conn?.effectiveType === 'string' ? conn.effectiveType : '';
		if (t === 'slow-2g' || t === '2g') return true;
	} catch {
		// ignore
	}
	return false;
}

/**
 * @param {HTMLVideoElement} video
 * @returns {DoomVideoWarmLevel | ''}
 */
export function doomVideoWarmLevel(video) {
	const v = video?.getAttribute?.('data-chat-doom-warm');
	return v === 'metadata' || v === 'auto' ? v : '';
}

/**
 * @param {HTMLVideoElement} video
 * @param {DoomVideoWarmLevel} level
 * @returns {boolean} whether level was applied
 */
export function warmDoomVideoElement(video, level) {
	if (!(video instanceof HTMLVideoElement)) return false;
	if (!video.src && !video.currentSrc) return false;

	const cur = doomVideoWarmLevel(video);
	if (level === 'metadata') {
		if (cur === 'metadata' || cur === 'auto') return false;
		video.preload = 'metadata';
		video.setAttribute('data-chat-doom-warm', 'metadata');
		try {
			video.load();
		} catch {
			// ignore
		}
		return true;
	}

	if (level === 'auto') {
		if (shouldSkipAggressiveVideoWarm()) return false;
		if (cur === 'auto') return false;
		video.preload = 'auto';
		video.setAttribute('data-chat-doom-warm', 'auto');
		try {
			video.load();
		} catch {
			// ignore
		}
		return true;
	}

	return false;
}

/**
 * @param {HTMLElement | null | undefined} slide
 * @param {DoomVideoWarmLevel} level
 * @returns {boolean}
 */
export function warmDoomSlideVideo(slide, level) {
	if (!(slide instanceof HTMLElement)) return false;
	const v = slide.querySelector('video.chat-doom-video');
	return warmDoomVideoElement(v instanceof HTMLVideoElement ? v : null, level);
}
