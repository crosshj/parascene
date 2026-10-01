/**
 * Record or upload an audio clip → POST /api/audio-clips/record
 */

import { pickAudioRecorderMimeType } from './extractVideoAudio.js';

/** @type {HTMLDialogElement | null} */
let modalEl = null;

function ensureModal() {
	if (modalEl) return modalEl;
	modalEl = document.createElement('dialog');
	modalEl.className = 'audio-clip-ingest-modal';
	modalEl.setAttribute('data-audio-clip-ingest-modal', '');
	modalEl.innerHTML = `
		<div class="audio-clip-ingest-panel">
			<div class="audio-clip-ingest-header">
				<h2 class="audio-clip-ingest-title" data-audio-clip-ingest-title>Add audio clip</h2>
				<button type="button" class="modal-close" data-audio-clip-ingest-close aria-label="Close">×</button>
			</div>
			<div class="form-group">
				<label class="form-label" for="audio-clip-ingest-title-input">Title</label>
				<input class="form-input" id="audio-clip-ingest-title-input" data-audio-clip-ingest-title-input type="text" placeholder="Clip title" />
			</div>
			<div class="audio-clip-ingest-record" data-audio-clip-ingest-record-panel hidden>
				<div class="form-group audio-clip-ingest-duration-field">
					<label class="form-label" for="audio-clip-ingest-target-sec">Target length (optional)</label>
					<div class="audio-clip-ingest-duration-row">
						<input
							type="number"
							class="form-input"
							id="audio-clip-ingest-target-sec"
							data-audio-clip-ingest-target-sec
							min="1"
							max="600"
							step="1"
							inputmode="numeric"
							placeholder="No limit"
							value="9"
						/>
						<span class="audio-clip-ingest-duration-suffix">sec</span>
					</div>
				</div>
				<div class="audio-clip-ingest-record-timer" data-audio-clip-ingest-timer hidden>
					<p class="audio-clip-ingest-timer-text" data-audio-clip-ingest-timer-text aria-live="polite">0:00</p>
					<div class="audio-clip-ingest-timer-bar" data-audio-clip-ingest-timer-bar hidden>
						<div class="audio-clip-ingest-timer-fill" data-audio-clip-ingest-timer-fill></div>
					</div>
				</div>
				<p class="audio-clip-ingest-hint" data-audio-clip-ingest-status>Ready to record.</p>
				<audio controls class="audio-clip-ingest-preview" data-audio-clip-ingest-preview hidden></audio>
				<div class="audio-clip-ingest-actions">
					<button type="button" class="btn-primary" data-audio-clip-ingest-record-start>Start recording</button>
					<button type="button" class="btn-secondary" data-audio-clip-ingest-record-stop hidden>Stop</button>
				</div>
			</div>
			<div class="audio-clip-ingest-upload" data-audio-clip-ingest-upload-panel hidden>
				<p class="audio-clip-ingest-hint">Choose an audio file (max 20 MB).</p>
			</div>
			<p class="audio-clip-ingest-error" data-audio-clip-ingest-error hidden></p>
			<div class="audio-clip-ingest-footer">
				<button type="button" class="btn-secondary" data-audio-clip-ingest-cancel>Cancel</button>
				<button type="button" class="btn-primary" data-audio-clip-ingest-save disabled>Save clip</button>
			</div>
		</div>
	`;
	document.body.appendChild(modalEl);
	return modalEl;
}

function formatDurationSec(sec) {
	const n = Number(sec);
	if (!Number.isFinite(n) || n <= 0) return '';
	const total = Math.round(n);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${String(s).padStart(2, '0')}`;
}

async function uploadClipBlob({ blob, mimeType, title, durationSec, sourceType }) {
	const normalizedMime = String(mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm';
	const params = new URLSearchParams();
	if (title) params.set('title', title);
	if (durationSec != null && Number(durationSec) > 0) {
		params.set('duration_sec', String(durationSec));
	}
	params.set('source_type', sourceType || 'recorded');
	const qs = params.toString();
	const url = `/api/audio-clips/record${qs ? `?${qs}` : ''}`;
	const res = await fetch(url, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'Content-Type': normalizedMime,
			...(title ? { 'x-audio-clip-title': title } : {}),
			...(durationSec != null ? { 'x-audio-clip-duration-sec': String(durationSec) } : {}),
			'x-audio-clip-source-type': sourceType || 'recorded'
		},
		body: blob
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(data?.message || data?.error || 'Could not save audio clip');
	}
	return data?.item ?? data;
}

/**
 * @param {{ mode: 'record' | 'upload', file?: File, onSaved?: (item: object) => void }} options
 */
export function openAudioClipIngestModal({ mode = 'record', file = null, onSaved } = {}) {
	const modal = ensureModal();
	const titleInput = modal.querySelector('[data-audio-clip-ingest-title-input]');
	const recordPanel = modal.querySelector('[data-audio-clip-ingest-record-panel]');
	const uploadPanel = modal.querySelector('[data-audio-clip-ingest-upload-panel]');
	const statusEl = modal.querySelector('[data-audio-clip-ingest-status]');
	const previewEl = modal.querySelector('[data-audio-clip-ingest-preview]');
	const startBtn = modal.querySelector('[data-audio-clip-ingest-record-start]');
	const stopBtn = modal.querySelector('[data-audio-clip-ingest-record-stop]');
	const saveBtn = modal.querySelector('[data-audio-clip-ingest-save]');
	const cancelBtn = modal.querySelector('[data-audio-clip-ingest-cancel]');
	const closeBtn = modal.querySelector('[data-audio-clip-ingest-close]');
	const errEl = modal.querySelector('[data-audio-clip-ingest-error]');
	const titleHeading = modal.querySelector('[data-audio-clip-ingest-title]');

	/** @type {MediaRecorder | null} */
	let recorder = null;
	/** @type {MediaStream | null} */
	let stream = null;
	/** @type {Blob[]} */
	let chunks = [];
	/** @type {Blob | null} */
	let pendingBlob = null;
	let pendingMime = 'audio/webm';
	let pendingDuration = null;
	let recordStartedAt = 0;
	/** @type {number | null} */
	let recordTickId = null;
	/** @type {number | null} */
	let recordAutoStopId = null;
	/** @type {number | null} */
	let activeTargetSec = null;

	function parseTargetDurationSec() {
		const targetInput = modal.querySelector('[data-audio-clip-ingest-target-sec]');
		if (!(targetInput instanceof HTMLInputElement)) return null;
		const raw = targetInput.value.trim();
		if (!raw) return null;
		const n = Number(raw);
		if (!Number.isFinite(n) || n <= 0) return null;
		return Math.min(600, Math.max(1, Math.round(n)));
	}

	function clearRecordTimers() {
		if (recordTickId != null) {
			window.clearInterval(recordTickId);
			recordTickId = null;
		}
		if (recordAutoStopId != null) {
			window.clearTimeout(recordAutoStopId);
			recordAutoStopId = null;
		}
	}

	function setRecordingUi(active) {
		const timerEl = modal.querySelector('[data-audio-clip-ingest-timer]');
		const targetInput = modal.querySelector('[data-audio-clip-ingest-target-sec]');
		if (timerEl instanceof HTMLElement) timerEl.hidden = !active;
		if (targetInput instanceof HTMLInputElement) targetInput.disabled = active;
	}

	function updateRecordingIndicator(elapsedSec, targetSec) {
		const timerText = modal.querySelector('[data-audio-clip-ingest-timer-text]');
		const timerBar = modal.querySelector('[data-audio-clip-ingest-timer-bar]');
		const timerFill = modal.querySelector('[data-audio-clip-ingest-timer-fill]');
		const elapsedLabel = formatDurationSec(elapsedSec) || '0:00';
		if (timerText) {
			if (targetSec != null && targetSec > 0) {
				timerText.textContent = `${elapsedLabel} / ${formatDurationSec(targetSec)}`;
			} else {
				timerText.textContent = elapsedLabel;
			}
		}
		if (timerBar instanceof HTMLElement) {
			timerBar.hidden = !(targetSec != null && targetSec > 0);
		}
		if (timerFill instanceof HTMLElement && targetSec != null && targetSec > 0) {
			const ratio = Math.min(1, Math.max(0, elapsedSec / targetSec));
			timerFill.style.width = `${Math.round(ratio * 100)}%`;
		}
		if (statusEl) {
			if (targetSec != null && targetSec > 0) {
				const remaining = Math.max(0, targetSec - elapsedSec);
				statusEl.textContent = `Recording… ${formatDurationSec(remaining)} left`;
			} else {
				statusEl.textContent = 'Recording…';
			}
		}
	}

	function finishRecordingUi() {
		clearRecordTimers();
		setRecordingUi(false);
		const timerBar = modal.querySelector('[data-audio-clip-ingest-timer-bar]');
		const timerFill = modal.querySelector('[data-audio-clip-ingest-timer-fill]');
		if (timerBar instanceof HTMLElement) timerBar.hidden = true;
		if (timerFill instanceof HTMLElement) timerFill.style.width = '0%';
	}

	function setError(msg) {
		if (!errEl) return;
		errEl.textContent = msg || '';
		errEl.hidden = !msg;
	}

	function cleanupStream() {
		if (recorder && recorder.state !== 'inactive') {
			try { recorder.stop(); } catch { /* ignore */ }
		}
		recorder = null;
		if (stream) {
			for (const track of stream.getTracks()) track.stop();
		}
		stream = null;
	}

	function resetState() {
		finishRecordingUi();
		cleanupStream();
		chunks = [];
		pendingBlob = null;
		pendingDuration = null;
		activeTargetSec = null;
		if (previewEl instanceof HTMLAudioElement) {
			previewEl.removeAttribute('src');
			previewEl.hidden = true;
			previewEl.load();
		}
		if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = true;
		if (startBtn instanceof HTMLButtonElement) {
			startBtn.hidden = false;
			startBtn.disabled = false;
		}
		if (stopBtn instanceof HTMLButtonElement) stopBtn.hidden = true;
		setError('');
	}

	function closeModal() {
		resetState();
		document.body.classList.remove('modal-open');
		modal.close();
	}

	function enableSave(blob, mimeType, durationSec) {
		pendingBlob = blob;
		pendingMime = mimeType;
		pendingDuration = durationSec;
		if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = !blob;
		if (previewEl instanceof HTMLAudioElement && blob) {
			previewEl.src = URL.createObjectURL(blob);
			previewEl.hidden = false;
			previewEl.load();
		}
	}

	const isUpload = mode === 'upload';
	if (titleHeading) titleHeading.textContent = isUpload ? 'Upload audio clip' : 'Record audio clip';
	if (recordPanel instanceof HTMLElement) recordPanel.hidden = isUpload;
	if (uploadPanel instanceof HTMLElement) uploadPanel.hidden = !isUpload;
	if (titleInput instanceof HTMLInputElement) {
		titleInput.value = isUpload && file?.name
			? file.name.replace(/\.[^.]+$/, '')
			: `Recording ${new Date().toLocaleString()}`;
	}
	resetState();

	if (isUpload && file) {
		pendingMime = file.type || 'audio/mpeg';
		const audio = document.createElement('audio');
		audio.preload = 'metadata';
		audio.src = URL.createObjectURL(file);
		audio.addEventListener('loadedmetadata', () => {
			const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
			enableSave(file, pendingMime, d);
		}, { once: true });
		audio.addEventListener('error', () => {
			enableSave(file, pendingMime, null);
		}, { once: true });
	}

	const onSave = async () => {
		if (!pendingBlob || !(saveBtn instanceof HTMLButtonElement)) return;
		const title = titleInput instanceof HTMLInputElement ? titleInput.value.trim() : '';
		saveBtn.disabled = true;
		setError('');
		try {
			const item = await uploadClipBlob({
				blob: pendingBlob,
				mimeType: pendingMime,
				title: title || undefined,
				durationSec: pendingDuration,
				sourceType: isUpload ? 'upload' : 'recorded'
			});
			closeModal();
			if (typeof onSaved === 'function') onSaved(item);
		} catch (err) {
			setError(err?.message || 'Could not save clip');
			saveBtn.disabled = false;
		}
	};

	const onStopRecord = () => {
		finishRecordingUi();
		if (recorder && recorder.state === 'recording') recorder.stop();
		if (startBtn instanceof HTMLButtonElement) startBtn.hidden = false;
		if (stopBtn instanceof HTMLButtonElement) stopBtn.hidden = true;
	};

	const onStartRecord = async () => {
		if (!(startBtn instanceof HTMLButtonElement) || !(stopBtn instanceof HTMLButtonElement)) return;
		setError('');
		finishRecordingUi();
		const targetSec = parseTargetDurationSec();
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const mimeType = pickAudioRecorderMimeType();
			recorder = mimeType
				? new MediaRecorder(stream, { mimeType })
				: new MediaRecorder(stream);
			pendingMime = recorder.mimeType || mimeType || 'audio/webm';
			chunks = [];
			recordStartedAt = Date.now();
			recorder.addEventListener('dataavailable', (e) => {
				if (e.data && e.data.size > 0) chunks.push(e.data);
			});
			recorder.addEventListener('stop', () => {
				const blob = new Blob(chunks, { type: pendingMime });
				const elapsedSec = (Date.now() - recordStartedAt) / 1000;
				const durationSec =
					activeTargetSec != null && activeTargetSec > 0
						? activeTargetSec
						: elapsedSec;
				finishRecordingUi();
				if (statusEl) statusEl.textContent = 'Recording complete. Review and save.';
				enableSave(blob, pendingMime, durationSec);
				cleanupStream();
			});
			recorder.start();
			activeTargetSec = targetSec;
			setRecordingUi(true);
			updateRecordingIndicator(0, targetSec);
			startBtn.hidden = true;
			stopBtn.hidden = false;
			recordTickId = window.setInterval(() => {
				const elapsedSec = (Date.now() - recordStartedAt) / 1000;
				updateRecordingIndicator(elapsedSec, targetSec);
			}, 200);
			if (targetSec != null && targetSec > 0) {
				recordAutoStopId = window.setTimeout(() => {
					onStopRecord();
				}, targetSec * 1000);
			}
		} catch (err) {
			finishRecordingUi();
			setError(err?.message || 'Microphone access denied');
		}
	};

	closeBtn.onclick = closeModal;
	cancelBtn.onclick = closeModal;
	modal.addEventListener('cancel', (e) => {
		e.preventDefault();
		closeModal();
	});
	modal.addEventListener('click', (e) => {
		if (e.target === modal) closeModal();
	});
	startBtn.onclick = onStartRecord;
	stopBtn.onclick = onStopRecord;
	saveBtn.onclick = onSave;

	document.body.classList.add('modal-open');
	modal.showModal();
}

export { formatDurationSec };
