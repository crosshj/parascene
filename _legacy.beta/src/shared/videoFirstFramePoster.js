/**
 * Text-to-video (and Blue t2v) rows keep a transparent PNG until a first-frame poster is saved.
 * Reference-to-video has a source image, but it is a character sheet — not a start frame.
 * Feed / doom should show the video's first frame instead of that empty or sheet poster.
 */

/**
 * @param {object|null|undefined} item
 * @returns {object|null}
 */
function parseMeta(item) {
	const m = item?.meta;
	if (m && typeof m === 'object' && !Array.isArray(m)) return m;
	if (typeof m === 'string' && m) {
		try {
			const o = JSON.parse(m);
			return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * @param {object|null|undefined} item
 * @returns {string}
 */
export function feedItemPlayableVideoUrl(item) {
	const top = typeof item?.video_url === 'string' ? item.video_url.trim() : '';
	if (top) return top;
	const meta = parseMeta(item);
	const videoMeta = meta?.video;
	if (videoMeta && typeof videoMeta === 'object' && !Array.isArray(videoMeta)) {
		const path = typeof videoMeta.file_path === 'string' ? videoMeta.file_path.trim() : '';
		if (path) return path;
	}
	return '';
}

function hasSourceImage(item, meta) {
	const topSource = typeof item?.source_image_url === 'string' ? item.source_image_url.trim() : '';
	if (topSource) return true;
	const metaSource = typeof meta?.source_image_url === 'string' ? meta.source_image_url.trim() : '';
	if (metaSource) return true;
	const args = meta?.args && typeof meta.args === 'object' ? meta.args : null;
	if (!args) return false;
	for (const key of ['image_url', 'image', 'source_image_url']) {
		if (typeof args[key] === 'string' && args[key].trim()) return true;
	}
	if (Array.isArray(args.input_images)) {
		return args.input_images.some((x) => typeof x === 'string' && x.trim());
	}
	return false;
}

/** Keep in sync with isReferenceToVideoMethod in public/shared/aspectRatio.js. */
function isReferenceToVideoMeta(meta) {
	if (!meta || typeof meta !== 'object') return false;
	const method = String(meta.method || meta.provider_method || '').trim().toLowerCase().replace(/[_-]+/g, '');
	if (method === 'reference2video' || method === 'ref2video' || method === 'r2v') return true;
	const model = String(meta.args?.model || '').trim().toLowerCase();
	if (!model) return false;
	if (/(^|[^a-z0-9])r2v([^a-z0-9]|$)/i.test(model)) return true;
	const compact = model.replace(/[_-]+/g, '');
	return compact.includes('ref2video') || compact.includes('reference2video');
}

/**
 * True when the stored poster is still the auto-generated transparent placeholder.
 * Reference-to-video also needs a frame poster: the source image is a character sheet.
 * @param {object|null|undefined} item
 * @returns {boolean}
 */
export function feedItemNeedsVideoFramePoster(item) {
	if (!item || typeof item !== 'object') return false;
	const meta = parseMeta(item);
	if (meta?.video_placeholder_manual === true) return false;
	if (!feedItemPlayableVideoUrl(item)) return false;
	if (hasSourceImage(item, meta) && !isReferenceToVideoMeta(meta)) return false;
	const mediaTypeRaw =
		typeof item.media_type === 'string' && item.media_type.trim()
			? item.media_type
			: typeof meta?.media_type === 'string'
				? meta.media_type
				: '';
	const mediaType = mediaTypeRaw.trim().toLowerCase();
	if (mediaType && mediaType !== 'video') return false;
	return true;
}

/** @type {WeakMap<HTMLImageElement, () => void>} */
const cleanupByImg = new WeakMap();

function paintVideoFrameToBlobUrl(video) {
	if (!(video instanceof HTMLVideoElement)) return Promise.resolve('');
	const w = video.videoWidth;
	const h = video.videoHeight;
	if (!w || !h || video.readyState < 2) return Promise.resolve('');
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) return Promise.resolve('');
	try {
		ctx.drawImage(video, 0, 0, w, h);
	} catch {
		return Promise.resolve('');
	}
	return new Promise((resolve) => {
		canvas.toBlob((blob) => {
			if (!blob) {
				resolve('');
				return;
			}
			resolve(URL.createObjectURL(blob));
		}, 'image/jpeg', 0.86);
	});
}

/**
 * Paint the video's first frame onto `img`. Replaces any previous apply on the same img.
 *
 * @param {HTMLImageElement} img
 * @param {{
 *   videoUrl: string,
 *   existingVideo?: HTMLVideoElement | null,
 *   onPainted?: () => void,
 *   onFail?: () => void
 * }} opts
 * @returns {() => void} cleanup
 */
export function applyVideoFirstFramePoster(img, opts) {
	const prev = cleanupByImg.get(img);
	if (typeof prev === 'function') prev();
	cleanupByImg.delete(img);

	if (!(img instanceof HTMLImageElement)) {
		if (typeof opts?.onFail === 'function') opts.onFail();
		return () => {};
	}
	const videoUrl = typeof opts?.videoUrl === 'string' ? opts.videoUrl.trim() : '';
	if (!videoUrl || typeof document === 'undefined') {
		if (typeof opts?.onFail === 'function') opts.onFail();
		return () => {};
	}

	let cancelled = false;
	let settled = false;
	let blobUrl = '';
	const existing = opts?.existingVideo instanceof HTMLVideoElement ? opts.existingVideo : null;
	const video = existing || document.createElement('video');
	const owned = !existing;
	let failTimer = 0;

	const finishFail = () => {
		if (cancelled || settled) return;
		settled = true;
		if (failTimer) window.clearTimeout(failTimer);
		if (typeof opts?.onFail === 'function') opts.onFail();
	};

	const finishPainted = () => {
		if (cancelled || settled) return;
		settled = true;
		if (failTimer) window.clearTimeout(failTimer);
		if (typeof opts?.onPainted === 'function') opts.onPainted();
	};

	const tryPaint = async () => {
		if (cancelled || settled) return false;
		const nextUrl = await paintVideoFrameToBlobUrl(video);
		if (cancelled || settled) {
			if (nextUrl) URL.revokeObjectURL(nextUrl);
			return false;
		}
		if (!nextUrl) return false;
		if (blobUrl) URL.revokeObjectURL(blobUrl);
		blobUrl = nextUrl;
		img.onload = () => finishPainted();
		img.onerror = () => finishFail();
		img.src = blobUrl;
		img.dataset.feedImageUrl = blobUrl;
		if (img.complete && img.naturalHeight !== 0) finishPainted();
		return true;
	};

	const onReady = async () => {
		if (cancelled || settled) return;
		const painted = await tryPaint();
		if (painted || cancelled || settled) return;
		try {
			video.currentTime = 0;
		} catch {
			await tryPaint();
		}
	};

	video.addEventListener('loadeddata', onReady);
	video.addEventListener('seeked', () => {
		void tryPaint();
	});
	video.addEventListener('error', finishFail, { once: true });

	if (owned) {
		video.muted = true;
		video.playsInline = true;
		video.setAttribute('playsinline', '');
		video.preload = 'auto';
		video.src = videoUrl;
		try {
			video.load();
		} catch {
			// ignore
		}
	} else if (video.readyState >= 2) {
		void onReady();
	}

	failTimer = window.setTimeout(finishFail, 10000);

	const cleanup = () => {
		cancelled = true;
		if (failTimer) window.clearTimeout(failTimer);
		video.removeEventListener('loadeddata', onReady);
		if (blobUrl) {
			URL.revokeObjectURL(blobUrl);
			blobUrl = '';
		}
		if (owned) {
			try {
				video.pause();
			} catch {
				// ignore
			}
			video.removeAttribute('src');
			try {
				video.load();
			} catch {
				// ignore
			}
		}
		if (cleanupByImg.get(img) === cleanup) cleanupByImg.delete(img);
	};
	cleanupByImg.set(img, cleanup);
	return cleanup;
}
