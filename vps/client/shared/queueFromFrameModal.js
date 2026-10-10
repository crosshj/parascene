/**
 * Queue from frame — scrubber seeks a <video> backed by range-capable /api/videos/created URLs.
 */

const html = String.raw;

/** @type {HTMLElement | null} */
let modalRoot = null;
/** @type {QueueFromFrameModalDeps | null} */
let activeDeps = null;
/** @type {HTMLVideoElement | null} */
let pickerVideo = null;
let previewReady = false;

/**
 * @typedef {object} QueueFromFrameModalDeps
 * @property {string} videoUrl
 * @property {number} sourceId
 * @property {boolean} [published]
 * @property {'queue' | 'video-placeholder'} [mode]
 * @property {(file: File, options?: { uploadKind?: string }) => Promise<string>} [uploadImageFile]
 * @property {(item: object) => void} [addToMutateQueue]
 * @property {(file: File) => Promise<void>} [onPlaceholderConfirm]
 * @property {(message: string) => void} showToast
 */

export function formatVideoTime(sec) {
	if (!Number.isFinite(sec) || sec < 0) return '0:00';
	const total = Math.floor(sec);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function clampFrameTime(timeSec, durationSec) {
	const duration = Number(durationSec);
	const t = Number(timeSec);
	if (!Number.isFinite(duration) || duration <= 0) return 0;
	if (!Number.isFinite(t)) return 0;
	return Math.max(0, Math.min(t, Math.max(0, duration - 0.001)));
}

/**
 * Width and height from a PNG IHDR, or zeros when the bytes are not a PNG.
 * @param {Uint8Array} bytes
 */
export function pngSize(bytes) {
	const png = bytes instanceof Uint8Array ? bytes : new Uint8Array();
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (png.length < 24 || signature.some((byte, index) => png[index] !== byte)) return { width: 0, height: 0 };
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Ask the server for a frame. Playback stays on the signed video; the server
 * reads the stored file, so the browser never exports a tainted canvas.
 * @param {number} sourceId
 * @param {number} timeSec
 * @returns {Promise<{ file: File, width: number, height: number }>}
 */
export async function fetchServerVideoFrameFile(sourceId, timeSec) {
	const id = Number(sourceId);
	if (!Number.isFinite(id) || id <= 0) throw new Error('Video is not available');
	const time = Number(timeSec);
	const t = Number.isFinite(time) && time > 0 ? time : 0;
	const res = await fetch(`/api/creations/${id}/video-frame?t=${encodeURIComponent(t.toFixed(3))}`, {
		credentials: 'include',
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(data?.error || 'Could not read frame');
	}
	const bytes = new Uint8Array(await res.arrayBuffer());
	if (!bytes.byteLength) throw new Error('Could not read frame');
	const { width, height } = pngSize(bytes);
	const type = typeof res.headers?.get === 'function' && String(res.headers.get('content-type') || '').startsWith('image/')
		? String(res.headers.get('content-type')).split(';')[0]
		: 'image/png';
	return { file: new File([bytes], `frame-${id}.png`, { type }), width, height };
}

function getModalElements() {
	if (!modalRoot) return null;
	return {
		overlay: modalRoot,
		video: modalRoot.querySelector('[data-queue-from-frame-video]'),
		scrub: modalRoot.querySelector('[data-queue-from-frame-scrub]'),
		timeLabel: modalRoot.querySelector('[data-queue-from-frame-time]'),
		status: modalRoot.querySelector('[data-queue-from-frame-status]'),
		confirmBtn: modalRoot.querySelector('[data-queue-from-frame-confirm]'),
		cancelBtn: modalRoot.querySelector('[data-queue-from-frame-cancel]'),
		closeBtn: modalRoot.querySelector('[data-queue-from-frame-close]'),
	};
}

function setModalStatus(message, isError = false) {
	const { status } = getModalElements() || {};
	if (!status) return;
	const text = typeof message === 'string' ? message.trim() : '';
	status.textContent = text;
	status.hidden = !text;
	status.classList.toggle('is-error', Boolean(isError && text));
}

function setConfirmEnabled(enabled) {
	const { confirmBtn } = getModalElements() || {};
	if (confirmBtn instanceof HTMLButtonElement) confirmBtn.disabled = !enabled;
}

function getConfirmLabel(mode, busy) {
	if (mode === 'video-placeholder') {
		return busy ? 'Saving…' : 'Use this frame';
	}
	return busy ? 'Queuing…' : 'Add to queue';
}

function setModalBusy(busy) {
	const els = getModalElements();
	if (!els) return;
	els.overlay?.classList.toggle('is-busy', Boolean(busy));
	const { confirmBtn, cancelBtn, closeBtn, scrub, video } = els;
	const mode = activeDeps?.mode === 'video-placeholder' ? 'video-placeholder' : 'queue';
	if (confirmBtn instanceof HTMLButtonElement) {
		if (busy) {
			confirmBtn.disabled = true;
			if (!confirmBtn.querySelector('.queue-from-frame-btn-spinner')) {
				confirmBtn.insertAdjacentHTML('afterbegin', '<span class="queue-from-frame-btn-spinner" aria-hidden="true"></span>');
			}
			const label = confirmBtn.querySelector('.queue-from-frame-btn-label');
			if (label) label.textContent = getConfirmLabel(mode, true);
		} else {
			confirmBtn.querySelector('.queue-from-frame-btn-spinner')?.remove();
			const label = confirmBtn.querySelector('.queue-from-frame-btn-label');
			if (label) label.textContent = getConfirmLabel(mode, false);
			confirmBtn.disabled = !previewReady;
		}
	}
	if (cancelBtn instanceof HTMLButtonElement) cancelBtn.disabled = busy;
	if (closeBtn instanceof HTMLButtonElement) closeBtn.disabled = busy;
	if (scrub instanceof HTMLInputElement) scrub.disabled = busy;
	if (video instanceof HTMLVideoElement && busy) video.pause();
}

function updateTimeLabel(duration, scrubValue) {
	const { timeLabel } = getModalElements() || {};
	if (!(timeLabel instanceof HTMLElement)) return;
	timeLabel.textContent = `${formatVideoTime(Number(scrubValue))} / ${formatVideoTime(duration)}`;
}

function markPreviewReady() {
	previewReady = true;
	setConfirmEnabled(true);
	modalRoot?.classList.remove('is-preview-loading');
	setModalStatus('');
}

function seekPickerTo(timeSec) {
	if (!(pickerVideo instanceof HTMLVideoElement)) return;
	const duration = Number(pickerVideo.duration);
	if (!Number.isFinite(duration) || duration <= 0) return;
	const t = clampFrameTime(timeSec, duration);
	pickerVideo.pause();
	try {
		pickerVideo.currentTime = t;
	} catch {
		// ignore
	}
}

function onPickerSeeked() {
	if (pickerVideo instanceof HTMLVideoElement && pickerVideo.readyState >= 2 && pickerVideo.videoWidth > 0) {
		markPreviewReady();
	}
}

function attachPickerListeners(video) {
	video.addEventListener('seeked', onPickerSeeked);
	video.addEventListener('loadeddata', onPickerSeeked);
}

function detachPickerListeners(video) {
	video.removeEventListener('seeked', onPickerSeeked);
	video.removeEventListener('loadeddata', onPickerSeeked);
}

function ensureModalDom() {
	if (modalRoot) return modalRoot;
	const root = document.createElement('div');
	root.className = 'creation-detail-queue-frame-overlay';
	root.setAttribute('data-queue-from-frame-modal', '');
	root.setAttribute('aria-hidden', 'true');
	root.innerHTML = html`
		<div class="creation-detail-queue-frame-dialog" role="dialog" aria-modal="true" aria-labelledby="queue-from-frame-title">
			<div class="creation-detail-queue-frame-header">
				<h2 id="queue-from-frame-title" class="creation-detail-queue-frame-title">Queue from frame</h2>
				<button type="button" class="creation-detail-queue-frame-close" data-queue-from-frame-close aria-label="Close">×</button>
			</div>
			<p class="creation-detail-queue-frame-hint">Scrub to the frame you want, then add it to your mutate queue.</p>
			<div class="creation-detail-queue-frame-preview">
				<video class="creation-detail-queue-frame-video" data-queue-from-frame-video playsinline muted preload="auto"></video>
			</div>
			<div class="creation-detail-queue-frame-scrub-row">
				<input type="range" class="creation-detail-queue-frame-scrub" data-queue-from-frame-scrub min="0" max="0" step="0.01" value="0" aria-label="Frame position" disabled />
				<span class="creation-detail-queue-frame-time" data-queue-from-frame-time>0:00 / 0:00</span>
			</div>
			<p class="creation-detail-queue-frame-status" data-queue-from-frame-status role="status" hidden></p>
			<div class="creation-detail-queue-frame-footer">
				<button type="button" class="btn-secondary" data-queue-from-frame-cancel>Cancel</button>
				<button type="button" class="btn-primary" data-queue-from-frame-confirm disabled>
					<span class="queue-from-frame-btn-label">Add to queue</span>
				</button>
			</div>
		</div>
	`;
	modalRoot = root;
	document.body.appendChild(root);
	wireModalEvents(root);
	return root;
}

function closeQueueFromFrameModal() {
	if (!modalRoot) return;
	if (pickerVideo instanceof HTMLVideoElement) {
		detachPickerListeners(pickerVideo);
		pickerVideo.pause();
		pickerVideo.removeAttribute('src');
		try { pickerVideo.load(); } catch { /* ignore */ }
	}
	pickerVideo = null;
	previewReady = false;
	modalRoot.classList.remove('open', 'is-preview-loading');
	modalRoot.setAttribute('aria-hidden', 'true');
	document.body.style.overflow = '';
	activeDeps = null;
	setModalBusy(false);
	setModalStatus('');
}

function wireModalEvents(root) {
	root.addEventListener('click', (e) => {
		if (e.target === root) closeQueueFromFrameModal();
	});
	const { cancelBtn, closeBtn, confirmBtn, scrub } = getModalElements() || {};
	cancelBtn?.addEventListener('click', (e) => { e.preventDefault(); closeQueueFromFrameModal(); });
	closeBtn?.addEventListener('click', (e) => { e.preventDefault(); closeQueueFromFrameModal(); });

	if (scrub instanceof HTMLInputElement) {
		scrub.addEventListener('input', () => {
			const duration = Number(pickerVideo?.duration);
			if (Number.isFinite(duration)) updateTimeLabel(duration, Number(scrub.value));
			seekPickerTo(Number(scrub.value));
		});
		scrub.addEventListener('change', () => {
			const duration = Number(pickerVideo?.duration);
			if (Number.isFinite(duration)) updateTimeLabel(duration, Number(scrub.value));
			seekPickerTo(Number(scrub.value));
		});
	}

	confirmBtn?.addEventListener('click', async (e) => {
		e.preventDefault();
		const deps = activeDeps;
		const els = getModalElements();
		if (!deps || !els) return;
		const { scrub: s, confirmBtn: btn } = els;
		if (!(s instanceof HTMLInputElement) || !(btn instanceof HTMLButtonElement)) return;
		if (btn.disabled) return;

		setModalStatus('');
		setModalBusy(true);
		try {
			const { file } = await fetchServerVideoFrameFile(deps.sourceId, Number(s.value));
			if (deps.mode === 'video-placeholder') {
				if (typeof deps.onPlaceholderConfirm !== 'function') {
					throw new Error('Poster save is not available');
				}
				await deps.onPlaceholderConfirm(file);
				deps.showToast('Poster updated');
			} else {
				if (typeof deps.uploadImageFile !== 'function' || typeof deps.addToMutateQueue !== 'function') {
					throw new Error('Queue is not available');
				}
				const imageUrl = await deps.uploadImageFile(file);
				deps.addToMutateQueue({
					sourceId: deps.sourceId,
					imageUrl,
					published: deps.published,
					fromFrame: true,
					frameTimeSec: Number(s.value),
				});
				deps.showToast('Added to queue');
			}
			closeQueueFromFrameModal();
		} catch (err) {
			setModalBusy(false);
			setModalStatus(err?.message || 'Could not queue frame', true);
		}
	});

	if (root.dataset.keydownBound !== '1') {
		root.dataset.keydownBound = '1';
		document.addEventListener('keydown', (ev) => {
			if (!modalRoot?.classList.contains('open') || ev.key !== 'Escape') return;
			ev.preventDefault();
			closeQueueFromFrameModal();
		});
	}
}

function beginPicker(videoUrl, initialTimeHint) {
	const { video, scrub } = getModalElements() || {};
	if (!(video instanceof HTMLVideoElement) || !(scrub instanceof HTMLInputElement)) return;

	pickerVideo = video;
	pickerVideo.pause();
	pickerVideo.muted = true;
	pickerVideo.playsInline = true;
	pickerVideo.setAttribute('playsinline', '');
	pickerVideo.preload = 'auto';
	pickerVideo.removeAttribute('poster');
	pickerVideo.removeAttribute('crossorigin');

	attachPickerListeners(pickerVideo);

	const finishReady = () => {
		const duration = Number(pickerVideo?.duration);
		if (!(pickerVideo instanceof HTMLVideoElement) || !Number.isFinite(duration) || duration <= 0) {
			setModalStatus('Could not read video duration', true);
			return;
		}
		let defaultTime = clampFrameTime(duration - 0.05, duration);
		if (Number.isFinite(initialTimeHint) && initialTimeHint >= 0) {
			defaultTime = clampFrameTime(initialTimeHint, duration);
		}
		scrub.min = '0';
		scrub.max = String(duration);
		scrub.step = String(Math.min(0.05, duration / 200));
		scrub.value = String(defaultTime);
		scrub.disabled = false;
		updateTimeLabel(duration, defaultTime);
		setModalStatus('');
		seekPickerTo(defaultTime);
	};

	const onMeta = () => {
		pickerVideo?.removeEventListener('loadedmetadata', onMeta);
		if (pickerVideo?.readyState >= 2) finishReady();
		else pickerVideo?.addEventListener('loadeddata', () => finishReady(), { once: true });
	};

	setModalStatus('Loading video…');
	pickerVideo.addEventListener('error', () => setModalStatus('Could not load video', true), { once: true });
	pickerVideo.src = videoUrl;
	try { pickerVideo.load(); } catch { /* ignore */ }

	if (pickerVideo.readyState >= 1 && Number.isFinite(pickerVideo.duration) && pickerVideo.duration > 0) {
		if (pickerVideo.readyState >= 2) finishReady();
		else pickerVideo.addEventListener('loadeddata', () => finishReady(), { once: true });
	} else {
		pickerVideo.addEventListener('loadedmetadata', onMeta);
	}
}

/**
 * @param {QueueFromFrameModalDeps} deps
 */
function applyModalModeCopy(mode) {
	const titleEl = modalRoot?.querySelector('#queue-from-frame-title');
	const hintEl = modalRoot?.querySelector('.creation-detail-queue-frame-hint');
	if (titleEl instanceof HTMLElement) {
		titleEl.textContent = mode === 'video-placeholder' ? 'Set poster from frame' : 'Queue from frame';
	}
	if (hintEl instanceof HTMLElement) {
		hintEl.textContent = mode === 'video-placeholder'
			? 'Scrub to the frame you want to use as the video poster, then save it.'
			: 'Scrub to the frame you want, then add it to your mutate queue.';
	}
	const label = modalRoot?.querySelector('.queue-from-frame-btn-label');
	if (label instanceof HTMLElement) {
		label.textContent = getConfirmLabel(mode, false);
	}
}

export function openQueueFromFrameModal(deps) {
	const videoUrl = typeof deps?.videoUrl === 'string' ? deps.videoUrl.trim() : '';
	const sourceId = Number(deps?.sourceId);
	if (!videoUrl || !Number.isFinite(sourceId) || sourceId <= 0) return;

	ensureModalDom();
	const mode = deps?.mode === 'video-placeholder' ? 'video-placeholder' : 'queue';
	activeDeps = { ...deps, mode };
	applyModalModeCopy(mode);
	previewReady = false;
	setConfirmEnabled(false);
	setModalBusy(false);
	setModalStatus('Loading video…');
	modalRoot?.classList.add('is-preview-loading', 'open');
	modalRoot?.setAttribute('aria-hidden', 'false');
	document.body.style.overflow = 'hidden';

	const hero = document.querySelector('[data-video]');
	const initialTime =
		hero instanceof HTMLVideoElement && Number.isFinite(hero.currentTime) ? hero.currentTime : NaN;
	beginPicker(videoUrl, initialTime);
}
