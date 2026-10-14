/**
 * Text-to-video (and Blue t2v) rows keep a transparent PNG until a first-frame poster is saved.
 * Reference-to-video has a source image, but it is a character sheet — not a start frame.
 * Feed / doom should show a server-extracted frame instead of that empty or sheet poster.
 * Signed playback redirects taint a canvas, so the browser must not export the frame itself.
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

/** Keep this classification aligned with the `aspectRatio.js` helper. */
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

/**
 * Same-origin media URL whose `video_thumbnail` variant is a server-extracted frame.
 * Falls back to the creation frame route when the playable URL is a signed redirect.
 * @param {string} videoUrl
 * @param {number} creationId
 * @returns {string}
 */
export function videoFramePosterUrl(videoUrl, creationId) {
	const id = Number(creationId);
	const hasId = Number.isFinite(id) && id > 0;
	const raw = typeof videoUrl === 'string' ? videoUrl.trim() : '';
	if (raw) {
		try {
			const parsed = new URL(raw, 'http://localhost');
			const path = parsed.pathname;
			if (
				path.includes('/api/videos/created/') ||
				path.includes('/api/creations/media/') ||
				path.includes('/api/images/created/')
			) {
				if (hasId) parsed.searchParams.set('creation_id', String(id));
				parsed.searchParams.set('variant', 'video_thumbnail');
				return `${parsed.pathname}${parsed.search}${parsed.hash}`;
			}
		} catch {
			// Fall through to the creation frame route.
		}
	}
	if (hasId) return `/api/creations/${id}/video-frame?t=0.000`;
	return '';
}

/**
 * Server frame URL when this row still needs a poster, otherwise empty.
 * @param {object|null|undefined} item
 * @returns {string}
 */
export function serverVideoFramePosterUrl(item) {
	if (!feedItemNeedsVideoFramePoster(item)) return '';
	const id = Number(item?.created_image_id ?? item?.id);
	return videoFramePosterUrl(feedItemPlayableVideoUrl(item), id);
}

/** @type {WeakMap<HTMLImageElement, () => void>} */
const cleanupByImg = new WeakMap();

/**
 * Show a server-extracted frame on `img`. Replaces any previous apply on the same img.
 *
 * @param {HTMLImageElement} img
 * @param {{
 *   videoUrl?: string,
 *   creationId?: number|string,
 *   onPainted?: () => void,
 *   onFail?: () => void
 * }} opts
 * @returns {() => void} cleanup
 */
export function applyVideoFirstFramePoster(img, opts) {
	const prev = cleanupByImg.get(img);
	if (typeof prev === 'function') prev();
	cleanupByImg.delete(img);

	const fail = () => {
		if (typeof opts?.onFail === 'function') opts.onFail();
	};

	if (!(img instanceof HTMLImageElement)) {
		fail();
		return () => {};
	}
	const frameUrl = videoFramePosterUrl(opts?.videoUrl, Number(opts?.creationId));
	if (!frameUrl) {
		fail();
		return () => {};
	}

	let cancelled = false;
	let settled = false;

	const finishFail = () => {
		if (cancelled || settled) return;
		settled = true;
		if (typeof opts?.onFail === 'function') opts.onFail();
	};

	const finishPainted = () => {
		if (cancelled || settled) return;
		settled = true;
		if (typeof opts?.onPainted === 'function') opts.onPainted();
	};

	img.onload = () => finishPainted();
	img.onerror = () => finishFail();
	img.src = frameUrl;
	img.dataset.feedImageUrl = frameUrl;
	if (img.complete && img.naturalHeight !== 0) finishPainted();

	const cleanup = () => {
		cancelled = true;
		if (img.onload) img.onload = null;
		if (img.onerror) img.onerror = null;
		if (cleanupByImg.get(img) === cleanup) cleanupByImg.delete(img);
	};
	cleanupByImg.set(img, cleanup);
	return cleanup;
}
