/**
 * Provider form field: minimal trigger + modal to pick a library audio clip.
 */

import { createAudioClipPickerModalDom, wireAudioClipPickerModal } from './audioClipPickerModal.js';

const AUDIO_ICON_SVG = `<svg class="audio-clip-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;

function formatClipDuration(sec) {
	const n = Number(sec);
	if (!Number.isFinite(n) || n <= 0) return '';
	const total = Math.round(n);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${String(s).padStart(2, '0')}`;
}

function toAbsoluteUrl(path) {
	const value = typeof path === 'string' ? path.trim() : '';
	if (!value) return '';
	if (value.startsWith('http://') || value.startsWith('https://')) return value;
	const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
	return `${origin}${value.startsWith('/') ? value : `/${value}`}`;
}

export function isAudioClipUrlField(fieldKey, field) {
	const key = String(fieldKey || '').toLowerCase();
	const label = String(field?.label || '').toLowerCase();
	if (field?.type === 'audio_url' || field?.type === 'audio_clip') return true;
	if (/input_audio|audio_url|audio_urls/.test(key)) return true;
	if (/input audio|audio url|audio clip/.test(label)) return true;
	return false;
}

/**
 * @param {string} fieldKey
 * @param {object} field
 * @param {{ inputClassName: string, fieldIdPrefix: string, onValueChange: function }} context
 */
export function createAudioClipPickerField(fieldKey, field, context) {
	const { fieldIdPrefix, onValueChange } = context;
	const wrapper = document.createElement('div');
	wrapper.className = 'audio-clip-field';

	const urlInput = document.createElement('input');
	urlInput.type = 'hidden';
	urlInput.id = `${fieldIdPrefix}${fieldKey}`;
	urlInput.name = fieldKey;
	if (field.required) urlInput.required = true;

	const clipIdInput = document.createElement('input');
	clipIdInput.type = 'hidden';
	clipIdInput.id = `${fieldIdPrefix}audio_clip_id`;
	clipIdInput.name = 'audio_clip_id';

	const placeholderBtn = document.createElement('button');
	placeholderBtn.type = 'button';
	placeholderBtn.className = 'audio-clip-field-placeholder';
	placeholderBtn.setAttribute('aria-label', 'Choose audio clip');
	placeholderBtn.innerHTML = `<span class="audio-clip-field-placeholder-icon">${AUDIO_ICON_SVG}</span><span class="audio-clip-field-placeholder-text">Choose audio clip</span>`;

	const selectedEl = document.createElement('div');
	selectedEl.className = 'audio-clip-field-selected';
	selectedEl.hidden = true;

	const chipEl = document.createElement('button');
	chipEl.type = 'button';
	chipEl.className = 'audio-clip-field-chip';
	chipEl.setAttribute('aria-label', 'Change audio clip');

	const chipIcon = document.createElement('span');
	chipIcon.className = 'audio-clip-field-chip-icon';
	chipIcon.innerHTML = AUDIO_ICON_SVG;

	const chipText = document.createElement('span');
	chipText.className = 'audio-clip-field-chip-text';

	const chipTitle = document.createElement('span');
	chipTitle.className = 'audio-clip-field-chip-title';

	const chipMeta = document.createElement('span');
	chipMeta.className = 'audio-clip-field-chip-meta';

	chipText.append(chipTitle, chipMeta);
	chipEl.append(chipIcon, chipText);

	const removeBtn = document.createElement('button');
	removeBtn.type = 'button';
	removeBtn.className = 'audio-clip-field-remove';
	removeBtn.setAttribute('aria-label', 'Remove audio');
	removeBtn.textContent = 'Remove';

	selectedEl.append(chipEl, removeBtn);

	const pickerRefs = createAudioClipPickerModalDom(context.inputClassName || 'form-input');
	wrapper.append(urlInput, clipIdInput, placeholderBtn, selectedEl, pickerRefs.modalOverlay);

	let selectedClipId = null;
	let selectedTitle = '';
	let selectedMeta = '';
	let selectedFromUrl = false;

	function notifyUrl(url) {
		const v = typeof url === 'string' ? url.trim() : '';
		urlInput.value = v;
		onValueChange(fieldKey, v);
	}

	function notifyClipId(id) {
		const n = Number(id);
		const v = Number.isFinite(n) && n > 0 ? String(n) : '';
		clipIdInput.value = v;
		onValueChange('audio_clip_id', v ? n : '');
	}

	function updateSelectedUi() {
		const hasValue = Boolean((urlInput.value || '').trim());
		placeholderBtn.hidden = hasValue;
		selectedEl.hidden = !hasValue;
		if (hasValue) {
			chipTitle.textContent = selectedTitle || (selectedFromUrl ? 'Custom URL' : 'Audio selected');
			chipMeta.textContent = selectedMeta || (selectedFromUrl ? 'Pasted link' : '');
			chipMeta.hidden = !chipMeta.textContent;
		}
	}

	function clearSelection() {
		selectedClipId = null;
		selectedTitle = '';
		selectedMeta = '';
		selectedFromUrl = false;
		notifyClipId(null);
		notifyUrl('');
		updateSelectedUi();
	}

	function setClipSelection(clip) {
		const id = Number(clip?.id);
		if (!Number.isFinite(id) || id <= 0) return;
		selectedClipId = id;
		selectedFromUrl = false;
		selectedTitle = String(clip.title || '').trim() || `Clip #${id}`;
		const dur = formatClipDuration(clip.duration_sec);
		const src = String(clip.source_type || '').replace(/_/g, ' ');
		selectedMeta = [dur, src].filter(Boolean).join(' · ');
		notifyClipId(id);
		notifyUrl(toAbsoluteUrl(clip.audio_url));
		updateSelectedUi();
	}

	function setUrlSelection(url) {
		const raw = typeof url === 'string' ? url.trim() : '';
		if (!raw) return;
		selectedClipId = null;
		selectedFromUrl = true;
		selectedTitle = 'Custom URL';
		selectedMeta = 'Pasted link';
		notifyClipId(null);
		notifyUrl(toAbsoluteUrl(raw));
		updateSelectedUi();
	}

	const { openModal } = wireAudioClipPickerModal(pickerRefs, {
		detachOnClose: false,
		onPick: (value) => {
			if (value?.type === 'clip') setClipSelection(value.clip);
			else if (value?.type === 'url') setUrlSelection(value.url);
		}
	});

	placeholderBtn.addEventListener('click', () => openModal());
	chipEl.addEventListener('click', () => openModal({ highlightClipId: selectedClipId }));
	removeBtn.addEventListener('click', () => clearSelection());

	const initial = typeof field?.default === 'string' ? field.default.trim() : '';
	if (initial) {
		setUrlSelection(initial);
	} else {
		notifyUrl('');
		notifyClipId(null);
		updateSelectedUi();
	}

	return wrapper;
}
