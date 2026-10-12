/**
 * Persist a video's first frame as the stored poster (browser capture, no ffmpeg).
 * Used when a job completes, on publish, and from "Use first frame as poster".
 *
 * Loaded via `import(\`.../saveVideoFirstFramePoster.js${qs}\`)`. Direct siblings must
 * use the same asset-version query; static `./aspectRatio.js` can resolve a stale copy
 * (missing exports).
 */
const _qs = (() => {
	try {
		const fromModule = new URL(import.meta.url).search;
		if (fromModule) return fromModule;
	} catch {
		/* ignore */
	}
	const v =
		typeof document !== 'undefined'
			? document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || ''
			: '';
	return v ? `?v=${encodeURIComponent(v)}` : '';
})();

/** @type {Set<number>} */
const inFlight = new Set();
/** @type {Set<number>} */
const attempted = new Set();

/** @type {null | ((creation: object) => boolean)} */
let shouldAutoSetVideoPosterFromFirstFrame = null;
/** @type {null | ((videoUrl: string, sourceId: number, options?: object) => Promise<{ file: File, width: number, height: number }>)} */
let captureVideoFirstFrameFile = null;

async function loadAspect() {
	if (typeof shouldAutoSetVideoPosterFromFirstFrame === 'function') return;
	const mod = await import(`./aspectRatio.js${_qs}`);
	shouldAutoSetVideoPosterFromFirstFrame = mod.shouldAutoSetVideoPosterFromFirstFrame;
}

async function loadCapture() {
	if (typeof captureVideoFirstFrameFile === 'function') return;
	const mod = await import(`./queueFromFrameModal.js${_qs}`);
	captureVideoFirstFrameFile = mod.captureVideoFirstFrameFile;
}

function creationIdOf(creation) {
	const id = Number(creation?.id ?? creation?.created_image_id);
	return Number.isFinite(id) && id > 0 ? id : 0;
}

function playableVideoUrl(creation) {
	const top = typeof creation?.video_url === 'string' ? creation.video_url.trim() : '';
	if (top) return top;
	const meta = creation?.meta;
	const obj = meta && typeof meta === 'object' ? meta : null;
	const path = typeof obj?.video?.file_path === 'string' ? obj.video.file_path.trim() : '';
	return path;
}

export function dispatchVideoPosterUpdated(detail) {
	if (typeof document === 'undefined') return;
	document.dispatchEvent(new CustomEvent('creation-video-placeholder-updated', { detail }));
}

/**
 * Capture the first frame and POST it as the stored poster.
 * @param {object} creation
 * @param {{ existingVideo?: HTMLVideoElement | null, dispatch?: boolean }} [options]
 * @returns {Promise<{ url?: string, width?: number, height?: number }>}
 */
export async function saveVideoFirstFramePoster(creation, options = {}) {
	const creationId = creationIdOf(creation);
	const videoUrl = playableVideoUrl(creation);
	if (!creationId || !videoUrl) {
		throw new Error('Video is not available');
	}
	await loadCapture();
	if (typeof captureVideoFirstFrameFile !== 'function') {
		throw new Error('Video is not available');
	}
	const existingVideo =
		options.existingVideo instanceof HTMLVideoElement ? options.existingVideo : null;
	const { file, width, height } = await captureVideoFirstFrameFile(videoUrl, creationId, {
		existingVideo,
	});
	const formData = new FormData();
	formData.append('image', file);
	formData.append('video_width', String(width));
	formData.append('video_height', String(height));
	const res = await fetch(`/api/create/images/${creationId}/video-placeholder`, {
		method: 'POST',
		credentials: 'include',
		body: formData,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(data?.message || data?.error || 'Could not set video poster');
	}
	if (options.dispatch !== false) {
		dispatchVideoPosterUpdated({
			creationId,
			url: data?.url,
			width: data?.width,
			height: data?.height,
		});
	}
	return data;
}

/**
 * Best-effort persist when the stored poster is still a placeholder or character sheet.
 * Skips if already saved, in flight, or previously attempted this page load.
 * @param {object|null|undefined} creation
 * @param {{ existingVideo?: HTMLVideoElement | null }} [options]
 * @returns {Promise<object|null>}
 */
export async function maybeSaveVideoFirstFramePoster(creation, options = {}) {
	await loadAspect();
	if (typeof shouldAutoSetVideoPosterFromFirstFrame !== 'function') return null;
	if (!shouldAutoSetVideoPosterFromFirstFrame(creation)) return null;
	const creationId = creationIdOf(creation);
	if (!creationId || inFlight.has(creationId) || attempted.has(creationId)) return null;
	inFlight.add(creationId);
	attempted.add(creationId);
	try {
		return await saveVideoFirstFramePoster(creation, options);
	} catch {
		return null;
	} finally {
		inFlight.delete(creationId);
	}
}
