/**
 * Edit an audio clip (title, description, thumbnail) → PATCH /api/audio-clips/:id
 */

import { audioClipMusicIcon } from '../icons/svg-strings.js';

const MUSIC_ICON_SVG = audioClipMusicIcon('audio-clip-edit-thumb-icon');

/** @type {HTMLElement | null} */
let modalOverlay = null;

function parseCreationIdFromLink(raw) {
	const s = String(raw ?? '').trim();
	if (!s) return null;
	const onlyDigits = /^\d+$/.exec(s);
	if (onlyDigits) {
		const n = parseInt(onlyDigits[0], 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	}
	try {
		const u = new URL(s, window.location.origin);
		const m = u.pathname.match(/\/creations\/(\d+)/);
		if (m) {
			const n = parseInt(m[1], 10);
			return Number.isFinite(n) && n > 0 ? n : null;
		}
	} catch {
		// ignore
	}
	const m2 = s.match(/\/creations\/(\d+)/);
	if (m2) {
		const n = parseInt(m2[1], 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	}
	return null;
}

function ensureModal() {
	if (modalOverlay) return modalOverlay;

	modalOverlay = document.createElement('div');
	modalOverlay.className = 'modal-overlay audio-clip-edit-modal-overlay';
	modalOverlay.setAttribute('data-audio-clip-edit-modal', '');

	const modal = document.createElement('div');
	modal.className = 'modal audio-clip-edit-modal';

	const modalHeader = document.createElement('div');
	modalHeader.className = 'modal-header';
	const modalTitle = document.createElement('h3');
	modalTitle.textContent = 'Edit audio clip';
	const modalClose = document.createElement('button');
	modalClose.type = 'button';
	modalClose.className = 'modal-close';
	modalClose.setAttribute('data-audio-clip-edit-close', '');
	modalClose.setAttribute('aria-label', 'Close');
	modalClose.innerHTML =
		'<svg class="modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

	modalHeader.append(modalTitle, modalClose);

	const modalBody = document.createElement('div');
	modalBody.className = 'modal-body audio-clip-edit-modal-body';
	modalBody.innerHTML = `
		<form class="audio-clip-edit-form" id="audio-clip-edit-form" data-audio-clip-edit-form>
			<div class="form-group">
				<label class="form-label" for="audio-clip-edit-title-input">Title</label>
				<input class="form-input" id="audio-clip-edit-title-input" data-audio-clip-edit-title-input type="text" required maxlength="200" autocomplete="off" />
			</div>
			<div class="form-group">
				<label class="form-label" for="audio-clip-edit-description-input">
					<span class="form-label-line">Description <span class="form-label-optional">(optional)</span></span>
				</label>
				<textarea class="form-input" id="audio-clip-edit-description-input" data-audio-clip-edit-description-input rows="2" maxlength="2000"></textarea>
			</div>
			<div class="form-group audio-clip-edit-thumb-group">
				<label class="form-label">Thumbnail</label>
				<div class="audio-clip-edit-thumb-row">
					<div class="audio-clip-edit-thumb-preview-wrap" data-audio-clip-edit-thumb-preview-wrap>
						<span class="audio-clip-edit-thumb-placeholder" data-audio-clip-edit-thumb-placeholder aria-hidden="true">${MUSIC_ICON_SVG}</span>
						<img class="audio-clip-edit-thumb-preview" data-audio-clip-edit-thumb-preview alt="" width="76" height="86" hidden decoding="async" />
					</div>
					<div class="audio-clip-edit-thumb-actions">
						<button type="button" class="btn-secondary audio-clip-edit-btn" data-audio-clip-edit-choose-image>Choose image</button>
						<button type="button" class="btn-secondary audio-clip-edit-btn" data-audio-clip-edit-remove-thumb hidden>Remove</button>
					</div>
				</div>
				<div class="audio-clip-edit-thumb-link">
					<label class="form-label" for="audio-clip-edit-creation-link">
						<span class="form-label-line">Creation link <span class="form-label-optional">(optional)</span></span>
					</label>
					<input class="form-input" id="audio-clip-edit-creation-link" data-audio-clip-edit-creation-link type="text" placeholder="/creations/123" autocomplete="off" />
					<p class="audio-clip-edit-field-hint">Published or your drafts. Saved as a copy for the library.</p>
				</div>
			</div>
			<p class="audio-clip-edit-error" data-audio-clip-edit-error hidden role="alert"></p>
		</form>
	`;

	const modalFooter = document.createElement('div');
	modalFooter.className = 'modal-footer audio-clip-edit-modal-footer';
	const cancelBtn = document.createElement('button');
	cancelBtn.type = 'button';
	cancelBtn.className = 'btn-secondary';
	cancelBtn.setAttribute('data-audio-clip-edit-cancel', '');
	cancelBtn.textContent = 'Cancel';
	const saveBtn = document.createElement('button');
	saveBtn.type = 'submit';
	saveBtn.className = 'btn-primary';
	saveBtn.setAttribute('data-audio-clip-edit-save', '');
	saveBtn.setAttribute('form', 'audio-clip-edit-form');
	saveBtn.textContent = 'Save';
	saveBtn.addEventListener('click', (e) => {
		const form = modalBody.querySelector('[data-audio-clip-edit-form]');
		if (form instanceof HTMLFormElement) {
			e.preventDefault();
			form.requestSubmit();
		}
	});

	modalFooter.append(cancelBtn, saveBtn);
	modal.append(modalHeader, modalBody, modalFooter);
	modalOverlay.appendChild(modal);
	document.body.appendChild(modalOverlay);

	const form = modalBody.querySelector('[data-audio-clip-edit-form]');
	const titleInput = modalBody.querySelector('[data-audio-clip-edit-title-input]');
	const descInput = modalBody.querySelector('[data-audio-clip-edit-description-input]');
	const creationLinkInput = modalBody.querySelector('[data-audio-clip-edit-creation-link]');
	const thumbPreview = modalBody.querySelector('[data-audio-clip-edit-thumb-preview]');
	const thumbPlaceholder = modalBody.querySelector('[data-audio-clip-edit-thumb-placeholder]');
	const chooseImageBtn = modalBody.querySelector('[data-audio-clip-edit-choose-image]');
	const removeThumbBtn = modalBody.querySelector('[data-audio-clip-edit-remove-thumb]');
	const errorEl = modalBody.querySelector('[data-audio-clip-edit-error]');

	let saving = false;
	let onSaved = null;
	let initialThumbUrl = '';
	let initialCreationLink = '';
	let initialHasCustomThumb = false;
	let pendingFile = null;
	let pendingPreviewUrl = null;
	let clearThumb = false;

	function setError(msg) {
		if (!(errorEl instanceof HTMLElement)) return;
		errorEl.textContent = msg || '';
		errorEl.hidden = !msg;
	}

	function revokePendingPreview() {
		if (pendingPreviewUrl) {
			URL.revokeObjectURL(pendingPreviewUrl);
			pendingPreviewUrl = null;
		}
	}

	function syncThumbPreview(displayUrl) {
		const url = typeof displayUrl === 'string' ? displayUrl.trim() : '';
		if (thumbPreview instanceof HTMLImageElement) {
			if (url) {
				thumbPreview.src = url;
				thumbPreview.hidden = false;
			} else {
				thumbPreview.removeAttribute('src');
				thumbPreview.hidden = true;
			}
		}
		if (thumbPlaceholder instanceof HTMLElement) {
			thumbPlaceholder.hidden = Boolean(url);
		}
		const showRemove =
			Boolean(pendingFile) ||
			(!clearThumb &&
				(Boolean(initialHasCustomThumb) ||
					(creationLinkInput instanceof HTMLInputElement && creationLinkInput.value.trim())));
		if (removeThumbBtn instanceof HTMLButtonElement) {
			removeThumbBtn.hidden = !showRemove;
		}
	}

	function setPendingFile(file) {
		revokePendingPreview();
		pendingFile = file instanceof File ? file : null;
		clearThumb = false;
		if (pendingFile) {
			pendingPreviewUrl = URL.createObjectURL(pendingFile);
			syncThumbPreview(pendingPreviewUrl);
			if (creationLinkInput instanceof HTMLInputElement) {
				creationLinkInput.value = '';
			}
		} else {
			syncThumbPreview(clearThumb ? '' : initialThumbUrl);
		}
	}

	function close() {
		if (saving) return;
		modalOverlay.classList.remove('open');
		document.removeEventListener('keydown', handleEscape);
		revokePendingPreview();
		pendingFile = null;
		clearThumb = false;
		onSaved = null;
	}

	function handleEscape(e) {
		if (e.key === 'Escape' && modalOverlay.classList.contains('open')) {
			close();
			e.preventDefault();
		}
	}

	modalClose.addEventListener('click', close);
	cancelBtn.addEventListener('click', close);
	modalOverlay.addEventListener('click', (e) => {
		if (e.target === modalOverlay) close();
	});
	modal.addEventListener('click', (e) => e.stopPropagation());

	removeThumbBtn?.addEventListener('click', () => {
		setPendingFile(null);
		clearThumb = true;
		if (creationLinkInput instanceof HTMLInputElement) {
			creationLinkInput.value = '';
		}
		syncThumbPreview('');
	});

	creationLinkInput?.addEventListener('input', () => {
		if (!(creationLinkInput instanceof HTMLInputElement)) return;
		if (creationLinkInput.value.trim()) {
			clearThumb = false;
			if (pendingFile) setPendingFile(null);
		}
		syncThumbPreview(
			pendingPreviewUrl || (clearThumb ? '' : initialThumbUrl)
		);
	});

	chooseImageBtn?.addEventListener('click', async () => {
		const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
		const qs = v ? `?v=${encodeURIComponent(v)}` : '';
		const { openImagePickerModal } = await import(`./providerFormFields.js${qs}`);
		openImagePickerModal({
			onSelect: async (value) => {
				if (value instanceof File) {
					setPendingFile(value);
					return;
				}
				const raw = String(value ?? '').trim();
				if (!raw) return;
				const creationId = parseCreationIdFromLink(raw);
				if (creationId) {
					if (creationLinkInput instanceof HTMLInputElement) {
						creationLinkInput.value = `/creations/${creationId}`;
					}
					clearThumb = false;
					setPendingFile(null);
					return;
				}
				try {
					const res = await fetch(raw, { credentials: 'include' });
					if (!res.ok) throw new Error('Could not load image');
					const blob = await res.blob();
					if (!blob.type.startsWith('image/')) throw new Error('Not an image');
					const ext = blob.type.includes('jpeg') ? 'jpg' : blob.type.includes('webp') ? 'webp' : 'png';
					setPendingFile(new File([blob], `clip-thumb.${ext}`, { type: blob.type }));
				} catch {
					setError('Could not load that image URL.');
				}
			}
		});
	});

	if (form instanceof HTMLFormElement) {
		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			if (saving) return;
			if (
				!(titleInput instanceof HTMLInputElement) ||
				!(descInput instanceof HTMLTextAreaElement) ||
				!(creationLinkInput instanceof HTMLInputElement)
			) {
				return;
			}

			const clipId = Number(modalOverlay.dataset.clipId);
			if (!Number.isFinite(clipId) || clipId <= 0) return;

			const clipTitle = titleInput.value.trim();
			if (!clipTitle) {
				setError('Title is required.');
				titleInput.focus();
				return;
			}

			saving = true;
			setError('');
			if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = true;

			try {
				let lastItem = null;

				if (pendingFile) {
					const thumbRes = await fetch(`/api/audio-clips/${clipId}/thumb`, {
						method: 'POST',
						credentials: 'include',
						headers: { 'Content-Type': pendingFile.type || 'application/octet-stream' },
						body: pendingFile
					});
					const thumbData = await thumbRes.json().catch(() => ({}));
					if (!thumbRes.ok) {
						throw new Error(thumbData?.error || thumbData?.message || 'Could not save clip image.');
					}
					lastItem = thumbData?.item ?? null;
				}

				const patchBody = {
					title: clipTitle,
					description: descInput.value.trim()
				};
				const creationLink = creationLinkInput.value.trim();
				const creationChanged = creationLink !== initialCreationLink;

				if (!pendingFile) {
					if (clearThumb && !creationLink) {
						patchBody.clear_thumb = true;
					} else if (creationLink && creationChanged) {
						patchBody.creation_link = creationLink;
					}
				}

				const patchRes = await fetch(`/api/audio-clips/${clipId}`, {
					method: 'PATCH',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
					body: JSON.stringify(patchBody)
				});
				const patchData = await patchRes.json().catch(() => ({}));
				if (!patchRes.ok) {
					throw new Error(patchData?.error || patchData?.message || 'Could not save changes.');
				}
				lastItem = patchData?.item ?? lastItem;

				const cb = onSaved;
				close();
				if (typeof cb === 'function') cb(lastItem);
			} catch (err) {
				setError(err?.message || 'Could not save changes.');
			} finally {
				saving = false;
				if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = false;
			}
		});
	}

	modalOverlay._open = ({
		clipId,
		title,
		description,
		thumbUrl = '',
		thumbCreationId = null,
		hasCustomThumb = false,
		onSaved: savedCb
	}) => {
		if (
			!(titleInput instanceof HTMLInputElement) ||
			!(descInput instanceof HTMLTextAreaElement) ||
			!(creationLinkInput instanceof HTMLInputElement)
		) {
			return;
		}

		modalOverlay.dataset.clipId = String(clipId);
		onSaved = typeof savedCb === 'function' ? savedCb : null;
		titleInput.value = typeof title === 'string' ? title : '';
		descInput.value = typeof description === 'string' ? description : '';

		initialThumbUrl = typeof thumbUrl === 'string' ? thumbUrl.trim() : '';
		initialHasCustomThumb = hasCustomThumb === true;
		const cid = Number(thumbCreationId);
		initialCreationLink =
			Number.isFinite(cid) && cid > 0 ? `/creations/${cid}` : '';
		creationLinkInput.value = initialCreationLink;

		revokePendingPreview();
		pendingFile = null;
		clearThumb = false;
		setError('');
		syncThumbPreview(initialThumbUrl);

		modalOverlay.classList.add('open');
		document.addEventListener('keydown', handleEscape);
		titleInput.focus();
	};

	return modalOverlay;
}

/**
 * @param {{
 *   clipId: number,
 *   title?: string,
 *   description?: string,
 *   thumbUrl?: string,
 *   thumbCreationId?: number | null,
 *   hasCustomThumb?: boolean,
 *   onSaved?: (item: object) => void
 * }} options
 */
export function openAudioClipEditModal({
	clipId,
	title = '',
	description = '',
	thumbUrl = '',
	thumbCreationId = null,
	hasCustomThumb = false,
	onSaved
}) {
	const id = Number(clipId);
	if (!Number.isFinite(id) || id <= 0) return;
	const modal = ensureModal();
	if (typeof modal._open === 'function') {
		modal._open({
			clipId: id,
			title,
			description,
			thumbUrl,
			thumbCreationId,
			hasCustomThumb,
			onSaved
		});
	}
}
