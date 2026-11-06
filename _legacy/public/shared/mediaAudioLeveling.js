/**
 * Browser-side loudness leveling via Web Audio (DynamicsCompressor).
 * Routes HTMLMediaElement audio through a shared compressor graph.
 */

/** @type {WeakMap<HTMLMediaElement, true>} */
const attached = new WeakMap();

/** @type {AudioContext | null} */
let sharedContext = null;

let gestureResumeBound = false;

/**
 * @param {string} mediaUrl
 * @param {string} [pageHref]
 */
export function isSameOriginMediaUrl(mediaUrl, pageHref = typeof location !== 'undefined' ? location.href : '') {
	if (!mediaUrl) return true;
	try {
		const mediaOrigin = new URL(mediaUrl, pageHref).origin;
		const pageOrigin = new URL(pageHref).origin;
		return mediaOrigin === pageOrigin;
	} catch {
		return false;
	}
}

/**
 * Set crossOrigin before cross-origin media loads so Web Audio can read samples.
 * No-op when same-origin or crossOrigin already set.
 *
 * @param {HTMLMediaElement} media
 */
export function primeMediaElementForAudioLeveling(media) {
	if (!(media instanceof HTMLMediaElement)) return;
	if (media.dataset.audioLevelingPrimed === '1') return;
	const url = media.currentSrc || media.src || media.getAttribute('src') || '';
	if (url && isSameOriginMediaUrl(url)) {
		media.dataset.audioLevelingPrimed = '1';
		return;
	}
	if (media.crossOrigin === 'anonymous' || media.crossOrigin === 'use-credentials') {
		media.dataset.audioLevelingPrimed = '1';
		return;
	}
	/* Already tainted without CORS — attaching would mute audio entirely. */
	if (url && media.readyState > 0) {
		media.dataset.audioLevelingSkip = '1';
		return;
	}
	media.crossOrigin = 'anonymous';
	media.dataset.audioLevelingPrimed = '1';
}

function getSharedAudioContext() {
	if (typeof window === 'undefined') return null;
	const Ctx = window.AudioContext || /** @type {typeof window & { webkitAudioContext?: typeof AudioContext }} */ (window).webkitAudioContext;
	if (!Ctx) return null;
	if (!sharedContext || sharedContext.state === 'closed') {
		sharedContext = new Ctx();
	}
	bindGestureResumeOnce();
	return sharedContext;
}

function bindGestureResumeOnce() {
	if (gestureResumeBound || typeof document === 'undefined') return;
	gestureResumeBound = true;
	const resume = () => {
		try {
			void sharedContext?.resume?.();
		} catch {
			// ignore
		}
	};
	document.addEventListener('pointerdown', resume, { capture: true, passive: true, once: true });
	document.addEventListener('keydown', resume, { capture: true, passive: true, once: true });
}

/**
 * @param {AudioContext} ctx
 */
function wireLevelingCompressor(ctx) {
	const compressor = ctx.createDynamicsCompressor();
	compressor.threshold.value = -24;
	compressor.knee.value = 30;
	compressor.ratio.value = 12;
	compressor.attack.value = 0.003;
	compressor.release.value = 0.25;

	const gain = ctx.createGain();
	gain.gain.value = 1;

	compressor.connect(gain);
	gain.connect(ctx.destination);
	return { compressor, gain };
}

/**
 * Route media element audio through a dynamics compressor (idempotent).
 *
 * @param {HTMLMediaElement | null | undefined} media
 * @returns {boolean}
 */
export function attachMediaAudioLeveling(media) {
	if (!(media instanceof HTMLMediaElement)) return false;
	if (media.dataset.audioLevelingSkip === '1') return false;
	if (attached.has(media)) return true;

	primeMediaElementForAudioLeveling(media);
	if (media.dataset.audioLevelingSkip === '1') return false;

	const ctx = getSharedAudioContext();
	if (!ctx) return false;

	try {
		const source = ctx.createMediaElementSource(media);
		const { compressor, gain } = wireLevelingCompressor(ctx);
		source.connect(compressor);
		attached.set(media, true);
		void ctx.resume();
		return true;
	} catch {
		/* Element may already be wired, or browser blocked Web Audio for this media. */
		return false;
	}
}

/** Resume shared leveling graph after a user gesture (e.g. doom unmute tap). */
export function resumeMediaAudioLevelingContext() {
	try {
		const p = sharedContext?.resume?.();
		if (p && typeof p.catch === 'function') p.catch(() => {});
	} catch {
		// ignore
	}
}
