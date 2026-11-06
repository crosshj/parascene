/**
 * Import Media modal: local audio file, or paste a Suno / YouTube link.
 * Modals only collect/confirm — callers own pending-grid import via importCreationWithPending.
 */

import {
	detectMediaImportUrl,
	previewMediaImport,
} from './importMedia.js';
import { getCreateWorkflowModalParent } from './createWorkflowHost.js';

function escapeHtml(text) {
	return String(text ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Paste-link modal for Import Media (Suno + YouTube).
 *
 * @param {{
 *   onConfirm?: (payload: { provider: 'suno'|'youtube'|'audio_file', url?: string, file?: File }, helpers?: { setStatus?: (status: string) => void }) => void | Promise<void>,
 *   onError?: (message: string) => void,
 * }} [options]
 */
export function openImportMediaModal(options = {}) {
	const existing = document.querySelector('[data-import-suno-modal]');
	if (existing) existing.remove();

	const overlay = document.createElement('div');
	overlay.className = 'import-suno-modal-overlay';
	overlay.setAttribute('data-import-suno-modal', '');
	overlay.setAttribute('aria-hidden', 'false');

	overlay.innerHTML = `
		<div class="import-suno-modal" role="dialog" aria-modal="true" aria-labelledby="import-media-modal-title">
			<div class="modal-header">
				<h3 id="import-media-modal-title">Import Media</h3>
				<button type="button" class="modal-close" data-import-suno-close aria-label="Close">
					<svg class="modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>
			<div class="import-suno-modal-body" data-import-suno-body>
				<p class="import-suno-modal-hint">Paste a Suno song link or a YouTube video link. We’ll save the cover and create a playable post.</p>
				<label class="import-suno-modal-label" for="import-media-url-input">Media URL</label>
				<input
					id="import-media-url-input"
					class="form-input import-suno-modal-input"
					type="url"
					inputmode="url"
					autocomplete="off"
					placeholder="https://suno.com/song/… or https://youtu.be/…"
					data-import-suno-url
				/>
				<div class="import-suno-modal-section">
					<p class="import-suno-modal-hint">Or upload an audio file from your computer. We’ll host the song, use the embedded cover if it has one, and make a playable post. MP3, WAV, FLAC, M4A — 50 MB max.</p>
					<label class="import-suno-modal-label" for="import-media-file-input">Audio file</label>
					<input
						id="import-media-file-input"
						class="form-input import-suno-modal-file"
						type="file"
						accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/flac,audio/ogg,audio/mp4,audio/aac,audio/x-m4a,audio/webm,.mp3,.wav,.flac,.m4a,.aac,.ogg,.oga,.mp4"
						data-import-media-file
					/>
					<p class="import-suno-modal-file-name" data-import-media-file-name hidden></p>
				</div>
				<p class="import-suno-modal-error" data-import-suno-error role="alert" hidden></p>
			</div>
			<div class="import-suno-modal-footer" data-import-suno-footer>
				<button type="button" class="btn-secondary" data-import-suno-cancel>Cancel</button>
				<button type="button" class="btn-primary" data-import-suno-submit>
					<span class="import-suno-modal-submit-spinner" data-import-suno-submit-spinner hidden aria-hidden="true"></span>
					<span data-import-suno-submit-label>Import</span>
				</button>
			</div>
		</div>
	`;

	getCreateWorkflowModalParent().appendChild(overlay);

	const urlInput = overlay.querySelector('[data-import-suno-url]');
	const fileInput = overlay.querySelector('[data-import-media-file]');
	const fileNameEl = overlay.querySelector('[data-import-media-file-name]');
	const errorEl = overlay.querySelector('[data-import-suno-error]');
	const submitBtn = overlay.querySelector('[data-import-suno-submit]');
	const submitLabel = overlay.querySelector('[data-import-suno-submit-label]');
	const submitSpinner = overlay.querySelector('[data-import-suno-submit-spinner]');
	const cancelBtn = overlay.querySelector('[data-import-suno-cancel]');
	const closeBtn = overlay.querySelector('[data-import-suno-close]');

	let closed = false;
	let busy = false;

	function setError(message) {
		if (!(errorEl instanceof HTMLElement)) return;
		const msg = typeof message === 'string' ? message.trim() : '';
		if (!msg) {
			errorEl.hidden = true;
			errorEl.textContent = '';
			return;
		}
		errorEl.hidden = false;
		errorEl.textContent = msg;
	}

	function setBusy(nextBusy, status) {
		busy = Boolean(nextBusy);
		overlay.classList.toggle('is-busy', busy);
		if (submitBtn instanceof HTMLButtonElement) {
			submitBtn.disabled = busy;
			submitBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
		}
		if (urlInput instanceof HTMLInputElement) urlInput.disabled = busy;
		if (fileInput instanceof HTMLInputElement) fileInput.disabled = busy;
		if (submitSpinner instanceof HTMLElement) {
			submitSpinner.hidden = !busy;
		}
		if (submitLabel instanceof HTMLElement) {
			submitLabel.textContent = busy ? status || 'Importing…' : 'Import';
		}
	}

	function setStatus(status) {
		if (closed || !busy) return;
		const text = typeof status === 'string' ? status.trim() : '';
		if (!text) return;
		if (submitLabel instanceof HTMLElement) submitLabel.textContent = text;
	}

	function close() {
		if (closed) return;
		closed = true;
		busy = false;
		document.removeEventListener('keydown', onKeyDown, true);
		overlay.remove();
	}

	function onKeyDown(e) {
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
		}
	}

	async function submit() {
		if (busy || closed) return;

		const file =
			fileInput instanceof HTMLInputElement && fileInput.files && fileInput.files[0]
				? fileInput.files[0]
				: null;

		let payload = null;
		if (file) {
			payload = { provider: 'audio_file', file };
		} else {
			const url = urlInput instanceof HTMLInputElement ? urlInput.value.trim() : '';
			if (!url) {
				setError('Paste a Suno or YouTube link, or choose an audio file below.');
				urlInput?.focus?.();
				return;
			}
			const detected = detectMediaImportUrl(url);
			if (!detected) {
				setError('Use a suno.com song link, a YouTube video link, or an audio file below.');
				urlInput?.focus?.();
				return;
			}
			payload = detected;
		}

		setError('');
		setBusy(true, file ? 'Uploading…' : 'Importing…');
		try {
			if (typeof options.onConfirm === 'function') {
				await options.onConfirm(payload, { setStatus });
			}
			if (!closed) close();
		} catch (err) {
			if (closed) return;
			const message =
				err instanceof Error && err.message
					? err.message
					: file
						? 'Could not import that audio file.'
						: 'Could not import that media.';
			setBusy(false);
			setError(message);
		}
	}

	function showSelectedFileName() {
		if (!(fileNameEl instanceof HTMLElement)) return;
		const file =
			fileInput instanceof HTMLInputElement && fileInput.files && fileInput.files[0]
				? fileInput.files[0]
				: null;
		if (!file) {
			fileNameEl.hidden = true;
			fileNameEl.textContent = '';
			return;
		}
		fileNameEl.hidden = false;
		fileNameEl.textContent = file.name || 'Audio file';
		setError('');
	}

	overlay.addEventListener('click', (e) => {
		if (e.target === overlay && !busy) close();
	});
	closeBtn?.addEventListener('click', () => close());
	cancelBtn?.addEventListener('click', () => close());
	submitBtn?.addEventListener('click', () => {
		void submit();
	});
	fileInput?.addEventListener('change', () => {
		showSelectedFileName();
	});
	urlInput?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			void submit();
		}
	});
	document.addEventListener('keydown', onKeyDown, true);

	requestAnimationFrame(() => {
		urlInput?.focus?.();
	});

	return { close };
}

/** @deprecated Use openImportMediaModal */
export function openImportSunoModal(options = {}) {
	return openImportMediaModal(options);
}

/**
 * Confirm when the composer detects a solo Suno/YouTube URL.
 *
 * @param {{
 *   url: string,
 *   provider?: 'suno'|'youtube',
 *   onConfirm?: (payload: {
 *     provider: 'suno'|'youtube',
 *     url: string,
 *     title: string,
 *     cover_url: string,
 *     existing_id: number|null,
 *   }) => void | Promise<void>,
 *   onCancel?: () => void,
 *   onError?: (message: string) => void,
 * }} options
 */
export function openImportMediaConfirmModal(options = {}) {
	const rawUrl = typeof options.url === 'string' ? options.url.trim() : '';
	const detected = detectMediaImportUrl(rawUrl);
	if (
		!detected ||
		(options.provider &&
			(options.provider === 'suno' || options.provider === 'youtube') &&
			detected.provider !== options.provider)
	) {
		if (typeof options.onError === 'function') {
			options.onError('Use a suno.com song link or a YouTube video link.');
		}
		return { close() {} };
	}

	const existing = document.querySelector('[data-import-suno-modal]');
	if (existing) existing.remove();

	const isYoutube = detected.provider === 'youtube';
	const confirmTitle = isYoutube ? 'Create a Video post?' : 'Create a Music post?';
	const kindLabel = isYoutube ? 'Video' : 'Song';

	const overlay = document.createElement('div');
	overlay.className = 'import-suno-modal-overlay';
	overlay.setAttribute('data-import-suno-modal', '');
	overlay.setAttribute('aria-hidden', 'false');

	overlay.innerHTML = `
		<div class="import-suno-modal" role="dialog" aria-modal="true" aria-labelledby="import-media-confirm-title">
			<div class="modal-header">
				<h3 id="import-media-confirm-title">${escapeHtml(confirmTitle)}</h3>
				<button type="button" class="modal-close" data-import-suno-close aria-label="Close">
					<svg class="modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>
			<div class="import-suno-modal-body" data-import-suno-body>
				<div class="import-suno-modal-skeleton" data-import-suno-checking aria-busy="true" aria-label="Checking media link">
					<div class="import-suno-modal-song-row">
						<span class="skeleton-line import-suno-modal-thumb-skeleton" aria-hidden="true"></span>
						<div class="import-suno-modal-song-meta">
							<span class="skeleton-line skeleton-line--short"></span>
							<span class="skeleton-line"></span>
							<span class="skeleton-line skeleton-line--medium"></span>
						</div>
					</div>
				</div>
				<div class="import-suno-modal-confirm" data-import-suno-confirm hidden>
					<p class="import-suno-modal-hint" data-import-suno-hint></p>
					<div class="import-suno-modal-song-row" data-import-suno-song hidden>
						<img class="import-suno-modal-thumb" data-import-suno-thumb alt="" hidden />
						<div class="import-suno-modal-song-meta">
							<div class="import-suno-modal-title" data-import-suno-title hidden></div>
						</div>
					</div>
					<p class="import-suno-modal-note" data-import-suno-note hidden></p>
				</div>
				<p class="import-suno-modal-error" data-import-suno-error role="alert" hidden></p>
			</div>
			<div class="import-suno-modal-footer" data-import-suno-footer>
				<button type="button" class="btn-secondary" data-import-suno-cancel>Cancel</button>
				<button type="button" class="btn-primary" data-import-suno-submit disabled>Create post</button>
			</div>
		</div>
	`;

	getCreateWorkflowModalParent().appendChild(overlay);

	const checkingEl = overlay.querySelector('[data-import-suno-checking]');
	const confirmEl = overlay.querySelector('[data-import-suno-confirm]');
	const hintEl = overlay.querySelector('[data-import-suno-hint]');
	const songRowEl = overlay.querySelector('[data-import-suno-song]');
	const thumbEl = overlay.querySelector('[data-import-suno-thumb]');
	const titleEl = overlay.querySelector('[data-import-suno-title]');
	const noteEl = overlay.querySelector('[data-import-suno-note]');
	const errorEl = overlay.querySelector('[data-import-suno-error]');
	const submitBtn = overlay.querySelector('[data-import-suno-submit]');
	const cancelBtn = overlay.querySelector('[data-import-suno-cancel]');
	const closeBtn = overlay.querySelector('[data-import-suno-close]');

	let closed = false;
	/** @type {string} */
	let importUrl = detected.url;
	/** @type {'suno'|'youtube'} */
	let provider = detected.provider;
	/** @type {{ title: string, cover_url: string, existing_id: number|null }} */
	let previewMeta = { title: '', cover_url: '', existing_id: null };

	function setError(message) {
		if (!(errorEl instanceof HTMLElement)) return;
		const msg = typeof message === 'string' ? message.trim() : '';
		if (!msg) {
			errorEl.hidden = true;
			errorEl.textContent = '';
			return;
		}
		errorEl.hidden = false;
		errorEl.textContent = msg;
	}

	function close(cancelled = false) {
		if (closed) return;
		closed = true;
		document.removeEventListener('keydown', onKeyDown, true);
		overlay.remove();
		if (cancelled && typeof options.onCancel === 'function') options.onCancel();
	}

	function onKeyDown(e) {
		if (e.key === 'Escape') {
			e.preventDefault();
			close(true);
		}
	}

	async function loadPreview() {
		try {
			const preview = await previewMediaImport(provider, detected.url);
			importUrl = preview.url || detected.url;
			provider = preview.provider;
			previewMeta = {
				title: typeof preview.title === 'string' ? preview.title.trim() : '',
				cover_url: typeof preview.cover_url === 'string' ? preview.cover_url.trim() : '',
				existing_id: preview.existing_id ?? null,
			};
			if (checkingEl instanceof HTMLElement) checkingEl.hidden = true;
			if (confirmEl instanceof HTMLElement) confirmEl.hidden = false;

			if (hintEl instanceof HTMLElement) {
				hintEl.textContent = isYoutube
					? 'We noticed a YouTube link in your prompt. Create a Video post from this link?'
					: 'We noticed a Suno link in your prompt. Create a Music post from this link?';
			}

			const title = previewMeta.title;
			const coverUrl = previewMeta.cover_url;
			const hasSongMeta = Boolean(title || coverUrl);
			const label = preview.kindLabel || kindLabel;

			if (songRowEl instanceof HTMLElement) {
				songRowEl.hidden = !hasSongMeta;
			}
			if (thumbEl instanceof HTMLImageElement) {
				if (coverUrl) {
					thumbEl.hidden = false;
					thumbEl.alt = title ? `Cover for ${title}` : `${label} cover`;
					thumbEl.referrerPolicy = 'no-referrer';
					thumbEl.decoding = 'async';
					thumbEl.loading = 'lazy';
					thumbEl.onerror = () => {
						thumbEl.hidden = true;
						thumbEl.removeAttribute('src');
						if (songRowEl instanceof HTMLElement && !title) {
							songRowEl.hidden = true;
						}
					};
					thumbEl.src = coverUrl;
				} else {
					thumbEl.hidden = true;
					thumbEl.removeAttribute('src');
					thumbEl.alt = '';
				}
			}
			if (titleEl instanceof HTMLElement) {
				if (title) {
					titleEl.hidden = false;
					titleEl.innerHTML = `<span class="import-suno-modal-title-label">${escapeHtml(label)}</span><span class="import-suno-modal-title-text">${escapeHtml(title)}</span>`;
				} else {
					titleEl.hidden = true;
					titleEl.textContent = '';
				}
			}
			if (noteEl instanceof HTMLElement) {
				const existingId = Number(previewMeta.existing_id);
				if (Number.isFinite(existingId) && existingId > 0) {
					noteEl.hidden = false;
					noteEl.textContent = isYoutube
						? 'You’ve already imported this video. Creating another post will add a new copy.'
						: 'You’ve already imported this song. Creating another post will add a new copy.';
				} else {
					noteEl.hidden = true;
					noteEl.textContent = '';
				}
			}
			if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
		} catch (err) {
			if (checkingEl instanceof HTMLElement) checkingEl.hidden = true;
			const message =
				err instanceof Error && err.message
					? err.message
					: 'Could not check that media link.';
			setError(message);
			if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;
			if (typeof options.onError === 'function') options.onError(message);
		}
	}

	async function submit() {
		if (!(submitBtn instanceof HTMLButtonElement) || submitBtn.disabled) return;
		close(false);
		if (typeof options.onConfirm === 'function') {
			try {
				await options.onConfirm({
					provider,
					url: importUrl,
					title: previewMeta.title,
					cover_url: previewMeta.cover_url,
					existing_id: previewMeta.existing_id,
				});
			} catch (err) {
				const message =
					err instanceof Error && err.message
						? err.message
						: 'Could not import that media.';
				if (typeof options.onError === 'function') options.onError(message);
				else alert(message);
			}
		}
	}

	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) close(true);
	});
	closeBtn?.addEventListener('click', () => {
		close(true);
	});
	cancelBtn?.addEventListener('click', () => {
		close(true);
	});
	submitBtn?.addEventListener('click', () => {
		void submit();
	});
	document.addEventListener('keydown', onKeyDown, true);

	void loadPreview();

	return { close: () => close(true) };
}

/** @deprecated Use openImportMediaConfirmModal */
export function openImportSunoConfirmModal(options = {}) {
	return openImportMediaConfirmModal(options);
}
