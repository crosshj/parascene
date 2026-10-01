const MIME_CANDIDATES = [
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/ogg;codecs=opus',
	'audio/mp4',
];

/**
 * @returns {string}
 */
export function pickAudioRecorderMimeType() {
	if (typeof MediaRecorder === 'undefined') return '';
	for (const mime of MIME_CANDIDATES) {
		if (MediaRecorder.isTypeSupported(mime)) return mime;
	}
	return '';
}

/**
 * Extract audio from a video URL by playing it through Web Audio and recording with MediaRecorder.
 * Runs in real time (a 5-minute video takes ~5 minutes).
 *
 * @param {string} videoUrl
 * @param {{ onProgress?: (ratio: number) => void, signal?: AbortSignal }} [options]
 * @returns {Promise<{ blob: Blob, mimeType: string, durationSec: number }>}
 */
export async function extractAudioFromVideoUrl(videoUrl, options = {}) {
	const mimeType = pickAudioRecorderMimeType();
	if (!mimeType) {
		throw new Error('Audio extraction is not supported in this browser');
	}

	const signal = options?.signal;
	if (signal?.aborted) {
		throw new DOMException('Aborted', 'AbortError');
	}

	const video = document.createElement('video');
	video.crossOrigin = 'anonymous';
	video.playsInline = true;
	video.preload = 'auto';
	video.src = String(videoUrl || '');

	await new Promise((resolve, reject) => {
		const onAbort = () => {
			cleanup();
			reject(new DOMException('Aborted', 'AbortError'));
		};
		const onError = () => {
			cleanup();
			reject(new Error('Could not load video for audio extraction'));
		};
		const onMeta = () => {
			cleanup();
			resolve();
		};
		const cleanup = () => {
			video.removeEventListener('loadedmetadata', onMeta);
			video.removeEventListener('error', onError);
			signal?.removeEventListener('abort', onAbort);
		};
		video.addEventListener('loadedmetadata', onMeta);
		video.addEventListener('error', onError);
		signal?.addEventListener('abort', onAbort);
		if (video.readyState >= 1) {
			cleanup();
			resolve();
		}
	});

	const durationSec = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;

	const audioContext = new AudioContext();
	const source = audioContext.createMediaElementSource(video);
	const destination = audioContext.createMediaStreamDestination();
	source.connect(destination);

	const recorder = new MediaRecorder(destination.stream, { mimeType });
	const chunks = [];

	recorder.ondataavailable = (event) => {
		if (event.data?.size) chunks.push(event.data);
	};

	const recordingDone = new Promise((resolve, reject) => {
		recorder.onstop = () => resolve();
		recorder.onerror = () => reject(new Error('Audio recording failed'));
	});

	let progressTimer = null;
	const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;
	if (onProgress && durationSec > 0) {
		progressTimer = window.setInterval(() => {
			onProgress(Math.min(1, video.currentTime / durationSec));
		}, 400);
	}

	recorder.start(1000);
	video.currentTime = 0;

	const playbackDone = new Promise((resolve, reject) => {
		const onAbort = () => {
			cleanup();
			reject(new DOMException('Aborted', 'AbortError'));
		};
		const onEnded = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error('Video playback failed during extraction'));
		};
		const cleanup = () => {
			video.removeEventListener('ended', onEnded);
			video.removeEventListener('error', onError);
			signal?.removeEventListener('abort', onAbort);
		};
		video.addEventListener('ended', onEnded);
		video.addEventListener('error', onError);
		signal?.addEventListener('abort', onAbort);
	});

	try {
		await video.play();
		await playbackDone;
	} catch (err) {
		try {
			recorder.stop();
		} catch {
			// ignore
		}
		throw err;
	} finally {
		if (progressTimer != null) window.clearInterval(progressTimer);
	}

	if (recorder.state !== 'inactive') {
		recorder.stop();
	}
	await recordingDone;

	video.pause();
	source.disconnect();
	destination.disconnect();
	await audioContext.close();

	const blob = new Blob(chunks, { type: mimeType });
	if (!blob.size) {
		throw new Error('No audio was captured from this video');
	}

	if (onProgress) onProgress(1);

	return { blob, mimeType, durationSec };
}
