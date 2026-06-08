/**
 * Share Audio modal — extract audio from a creation video or show an existing extracted file.
 */

import { extractAudioFromVideoUrl } from './extractVideoAudio.js';

/** @type {HTMLDialogElement | null} */
let modalEl = null;
/** @type {AbortController | null} */
let activeAbort = null;

function getModalElements() {
	if (!modalEl) {
		modalEl = document.querySelector('[data-share-audio-modal]');
	}
	if (!(modalEl instanceof HTMLDialogElement)) return null;
	return {
		modal: modalEl,
		closeBtn: modalEl.querySelector('[data-share-audio-close-btn]'),
		promptPanel: modalEl.querySelector('[data-share-audio-panel="prompt"]'),
		progressPanel: modalEl.querySelector('[data-share-audio-panel="progress"]'),
		readyPanel: modalEl.querySelector('[data-share-audio-panel="ready"]'),
		progressBar: modalEl.querySelector('[data-share-audio-progress-bar]'),
		progressLabel: modalEl.querySelector('[data-share-audio-progress-label]'),
		errorEl: modalEl.querySelector('[data-share-audio-error]'),
		audioEl: modalEl.querySelector('[data-share-audio-player]'),
		linkInput: modalEl.querySelector('[data-share-audio-link-input]'),
		copyBtn: modalEl.querySelector('[data-share-audio-copy-btn]'),
		extractBtn: modalEl.querySelector('[data-share-audio-extract-btn]'),
		extractBtnText: modalEl.querySelector('[data-share-audio-extract-btn-text]'),
	};
}

function setActivePanel(els, panelName) {
	const panels = {
		prompt: els.promptPanel,
		progress: els.progressPanel,
		ready: els.readyPanel,
	};
	for (const [name, panel] of Object.entries(panels)) {
		if (panel instanceof HTMLElement) {
			panel.classList.toggle('is-active', name === panelName);
		}
	}
}

function setExtractButtonVisible(els, visible) {
	if (els.extractBtn instanceof HTMLButtonElement) {
		els.extractBtn.classList.toggle('is-hidden', !visible);
	}
}

function toAbsoluteUrl(path) {
	const value = typeof path === 'string' ? path.trim() : '';
	if (!value) return '';
	if (value.startsWith('http://') || value.startsWith('https://')) return value;
	const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
	return `${origin}${value.startsWith('/') ? value : `/${value}`}`;
}

function formatProgressLabel(ratio) {
	const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
	return `Extracting audio… ${pct}%`;
}

function setExtractingUi(els, isExtracting, progress = 0) {
	if (isExtracting) {
		setActivePanel(els, 'progress');
	} else if (!els.readyPanel?.classList.contains('is-active')) {
		setActivePanel(els, 'prompt');
	}
	if (els.extractBtn instanceof HTMLButtonElement) {
		els.extractBtn.disabled = isExtracting;
	}
	if (els.progressBar instanceof HTMLElement) {
		els.progressBar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
	}
	if (els.progressLabel) {
		els.progressLabel.textContent = isExtracting ? formatProgressLabel(progress) : 'Extracting audio… 0%';
	}
}

function showError(els, message) {
	if (els.errorEl) {
		els.errorEl.textContent = message || '';
		els.errorEl.classList.toggle('is-visible', Boolean(message));
	}
}

function showReadyState(els, audioUrl) {
	const absUrl = toAbsoluteUrl(audioUrl);
	setActivePanel(els, 'ready');
	setExtractButtonVisible(els, false);
	if (els.extractBtn instanceof HTMLButtonElement) {
		els.extractBtn.disabled = false;
	}
	if (els.audioEl instanceof HTMLAudioElement) {
		els.audioEl.src = absUrl;
		els.audioEl.load();
	}
	if (els.linkInput instanceof HTMLInputElement) {
		els.linkInput.value = absUrl;
	}
	showError(els, '');
}

function showPromptState(els) {
	setActivePanel(els, 'prompt');
	setExtractButtonVisible(els, true);
	if (els.extractBtn instanceof HTMLButtonElement) {
		els.extractBtn.disabled = false;
	}
	if (els.audioEl instanceof HTMLAudioElement) {
		els.audioEl.removeAttribute('src');
		els.audioEl.load();
	}
	if (els.linkInput instanceof HTMLInputElement) els.linkInput.value = '';
	showError(els, '');
	setExtractingUi(els, false, 0);
}

function resolveShareAudioUrl(meta) {
	if (!meta || typeof meta !== 'object') return '';
	const filePath = typeof meta.file_path === 'string' ? meta.file_path.trim() : '';
	if (filePath) return filePath;
	const key = typeof meta.key === 'string' ? meta.key.trim() : '';
	if (key) {
		return `/api/images/generic/${key.split('/').filter(Boolean).map((seg) => encodeURIComponent(seg)).join('/')}`;
	}
	return '';
}

async function copyLink(els, showToast) {
	const url = els.linkInput instanceof HTMLInputElement ? els.linkInput.value.trim() : '';
	if (!url) return;
	let ok = false;
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(url);
			ok = true;
		}
	} catch {
		ok = false;
	}
	if (!ok && els.linkInput instanceof HTMLInputElement) {
		els.linkInput.focus();
		els.linkInput.select();
		try {
			ok = document.execCommand('copy');
		} catch {
			ok = false;
		}
	}
	if (typeof showToast === 'function') {
		showToast(ok ? 'Audio link copied' : 'Copy failed');
	}
}

async function uploadExtractedAudio(creationId, blob, mimeType) {
	const normalizedMime = String(mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm';
	const maxBytes = 20 * 1024 * 1024;
	if (blob.size > maxBytes) {
		throw new Error('Extracted audio is too large (max 20 MB). Try a shorter video.');
	}

	let res;
	try {
		res = await fetch(`/api/create/images/${creationId}/share-audio`, {
			method: 'POST',
			credentials: 'include',
			headers: {
				'Content-Type': normalizedMime,
			},
			body: blob,
		});
	} catch (err) {
		const msg = err?.message && typeof err.message === 'string' ? err.message : '';
		if (msg === 'Failed to fetch' || err?.name === 'TypeError') {
			throw new Error('Could not reach the server to save audio. If extraction took a long time, try again.');
		}
		throw err;
	}

	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(data?.message || data?.error || 'Could not save audio');
	}
	const audioUrl = typeof data?.audio_url === 'string'
		? data.audio_url
		: resolveShareAudioUrl(data?.share_audio);
	if (!audioUrl) {
		throw new Error('Audio saved but no URL was returned');
	}
	return audioUrl;
}

function bindModalHandlers(els) {
	if (els.modal.dataset.shareAudioBound === '1') return;
	els.modal.dataset.shareAudioBound = '1';

	const closeModal = () => {
		if (activeAbort) {
			activeAbort.abort();
			activeAbort = null;
		}
		document.body.classList.remove('modal-open');
		els.modal.close();
	};

	if (els.closeBtn) {
		els.closeBtn.onclick = closeModal;
	}
	els.modal.addEventListener('cancel', (e) => {
		e.preventDefault();
		closeModal();
	});
	els.modal.addEventListener('click', (e) => {
		if (e.target === els.modal) closeModal();
	});
}

/**
 * @param {object} options
 * @param {number} options.creationId
 * @param {string} options.videoUrl
 * @param {object | null | undefined} [options.shareAudio]
 * @param {(message: string) => void} [options.showToast]
 * @param {(audioUrl: string) => void} [options.onSaved]
 */
export function openShareAudioModal(options = {}) {
	const els = getModalElements();
	if (!els) return;

	const creationId = Number(options.creationId);
	const videoUrl = typeof options.videoUrl === 'string' ? options.videoUrl.trim() : '';
	const showToast = typeof options.showToast === 'function' ? options.showToast : null;
	const onSaved = typeof options.onSaved === 'function' ? options.onSaved : null;

	if (!Number.isFinite(creationId) || creationId <= 0 || !videoUrl) {
		if (showToast) showToast('Video is not available');
		return;
	}

	bindModalHandlers(els);

	const existingUrl = resolveShareAudioUrl(options.shareAudio);
	if (existingUrl) {
		showReadyState(els, existingUrl);
	} else {
		showPromptState(els);
	}

	if (els.copyBtn) {
		els.copyBtn.onclick = () => copyLink(els, showToast);
	}

	if (els.extractBtn) {
		els.extractBtn.onclick = async () => {
			if (activeAbort) return;
			activeAbort = new AbortController();
			showError(els, '');
			setExtractingUi(els, true, 0);
			if (els.extractBtnText) els.extractBtnText.textContent = 'Extracting…';

			try {
				const { blob, mimeType } = await extractAudioFromVideoUrl(videoUrl, {
					signal: activeAbort.signal,
					onProgress: (ratio) => setExtractingUi(els, true, ratio),
				});
				const audioUrl = await uploadExtractedAudio(creationId, blob, mimeType);
				showReadyState(els, audioUrl);
				if (showToast) showToast('Audio ready to share');
				if (onSaved) onSaved(audioUrl);
			} catch (err) {
				if (err?.name === 'AbortError') return;
				showError(els, err?.message || 'Could not extract audio');
				setExtractingUi(els, false, 0);
				if (els.extractBtnText) els.extractBtnText.textContent = 'Extract audio';
			} finally {
				activeAbort = null;
				if (els.extractBtnText && !els.readyPanel?.classList.contains('is-active')) {
					els.extractBtnText.textContent = 'Extract audio';
				}
			}
		};
	}

	document.body.classList.add('modal-open');
	els.modal.showModal();
}
