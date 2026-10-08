/**
 * Two-stage off-screen doom video warm-up (metadata → auto on swipe / visibility).
 * A later `preload` change is ignored once the element chose `none`, so a stalled
 * element (no frames, nothing in flight) is kicked with `load()`. Elements that
 * already have a frame are left alone — reloading those flashes black.
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
/**
 * True when the element has a source but has not received data and is not fetching.
 * @param {HTMLVideoElement} video
 */
export function doomVideoFetchStalled(video) {
	if (!(video instanceof HTMLVideoElement)) return false;
	if (video.readyState > 0) return false;
	if (video.networkState === 2) return false;
	return Boolean(video.getAttribute('src') || video.currentSrc || video.src);
}

/**
 * Start the resource selection that `preload="none"` skipped.
 * One kick per source so a later warm pass does not abort an in-flight fetch.
 * @param {HTMLVideoElement} video
 * @returns {boolean}
 */
export function kickDoomVideoFetch(video) {
	if (!doomVideoFetchStalled(video)) return false;
	const src = video.currentSrc || video.getAttribute('src') || video.src || '';
	if (video.getAttribute('data-chat-doom-fetch-src') !== src) {
		video.removeAttribute('data-chat-doom-fetch');
		if (src) video.setAttribute('data-chat-doom-fetch-src', src);
	}
	if (video.getAttribute('data-chat-doom-fetch') === '1') return false;
	video.setAttribute('data-chat-doom-fetch', '1');
	try {
		video.load();
	} catch {
		video.removeAttribute('data-chat-doom-fetch');
		return false;
	}
	return true;
}

export function warmDoomVideoElement(video, level) {
	if (!(video instanceof HTMLVideoElement)) return false;
	if (!video.src && !video.currentSrc) return false;

	const requested = level === 'auto' && shouldSkipAggressiveVideoWarm() ? 'metadata' : level;
	const cur = doomVideoWarmLevel(video);
	if (requested === 'metadata') {
		if (cur !== 'metadata' && cur !== 'auto') {
			video.preload = 'metadata';
			video.setAttribute('data-chat-doom-warm', 'metadata');
		}
		return kickDoomVideoFetch(video) || (cur !== 'metadata' && cur !== 'auto');
	}

	if (requested === 'auto') {
		if (cur !== 'auto') {
			video.preload = 'auto';
			video.setAttribute('data-chat-doom-warm', 'auto');
		}
		kickDoomVideoFetch(video);
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
