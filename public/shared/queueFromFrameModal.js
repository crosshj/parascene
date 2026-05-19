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
 * @property {(file: File, options?: { uploadKind?: string }) => Promise<string>} uploadImageFile
 * @property {(item: object) => void} addToMutateQueue
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

export function drawVideoFrameToCanvas(video, canvas) {
	if (!(video instanceof HTMLVideoElement) || !(canvas instanceof HTMLCanvasElement)) return false;
	const w = video.videoWidth;
	const h = video.videoHeight;
	if (!w || !h || video.readyState < 2) return false;
	const ctx = canvas.getContext('2d');
	if (!ctx) return false;
	if (canvas.width !== w) canvas.width = w;
	if (canvas.height !== h) canvas.height = h;
	ctx.drawImage(video, 0, 0, w, h);
	return true;
}

export async function captureCanvasFrameBlob(canvas) {
	if (!(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) {
		throw new Error('No frame selected');
	}
	return new Promise((resolve, reject) => {
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode frame'))), 'image/png');
	});
}

function getModalElements() {
	if (!modalRoot) return null;
	return {
		overlay: modalRoot,
		video: modalRoot.querySelector('[data-queue-from-frame-video]'),
		canvas: modalRoot.querySelector('[data-queue-from-frame-canvas]'),
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

function setModalBusy(busy) {
	const els = getModalElements();
	if (!els) return;
	els.overlay?.classList.toggle('is-busy', Boolean(busy));
	const { confirmBtn, cancelBtn, closeBtn, scrub, video } = els;
	if (confirmBtn instanceof HTMLButtonElement) {
		if (busy) {
			confirmBtn.disabled = true;
			if (!confirmBtn.querySelector('.queue-from-frame-btn-spinner')) {
				confirmBtn.insertAdjacentHTML('afterbegin', '<span class="queue-from-frame-btn-spinner" aria-hidden="true"></span>');
			}
			const label = confirmBtn.querySelector('.queue-from-frame-btn-label');
			if (label) label.textContent = 'Queuing…';
		} else {
			confirmBtn.querySelector('.queue-from-frame-btn-spinner')?.remove();
			const label = confirmBtn.querySelector('.queue-from-frame-btn-label');
			if (label) label.textContent = 'Add to queue';
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
				<canvas class="creation-detail-queue-frame-canvas" data-queue-from-frame-canvas hidden aria-hidden="true"></canvas>
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
		const { canvas, scrub: s, confirmBtn: btn } = els;
		if (!(canvas instanceof HTMLCanvasElement) || !(s instanceof HTMLInputElement) || !(btn instanceof HTMLButtonElement)) return;
		if (btn.disabled) return;

		setModalStatus('');
		setModalBusy(true);
		try {
			seekPickerTo(Number(s.value));
			if (pickerVideo instanceof HTMLVideoElement) {
				await new Promise((resolve) => {
					const done = () => {
						pickerVideo?.removeEventListener('seeked', done);
						resolve();
					};
					pickerVideo.addEventListener('seeked', done, { once: true });
					window.setTimeout(done, 800);
				});
			}
			if (!drawVideoFrameToCanvas(pickerVideo, canvas)) {
				throw new Error('Frame is not available yet');
			}
			const blob = await captureCanvasFrameBlob(canvas);
			const file = new File([blob], `frame-${deps.sourceId}.png`, { type: 'image/png' });
			const imageUrl = await deps.uploadImageFile(file, { uploadKind: 'edited' });
			deps.addToMutateQueue({
				sourceId: deps.sourceId,
				imageUrl,
				published: deps.published,
				fromFrame: true,
				frameTimeSec: Number(s.value),
			});
			deps.showToast('Added to queue');
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
export function openQueueFromFrameModal(deps) {
	const videoUrl = typeof deps?.videoUrl === 'string' ? deps.videoUrl.trim() : '';
	const sourceId = Number(deps?.sourceId);
	if (!videoUrl || !Number.isFinite(sourceId) || sourceId <= 0) return;

	ensureModalDom();
	activeDeps = deps;
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
