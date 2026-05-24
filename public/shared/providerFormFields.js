/**
 * Utilities for building forms from provider/server config (methods[].fields).
 * Field types are handled by separate handlers so new types can be added easily.
 */

import { parseAspectRatioString, shouldUseAspectRatioSelector, ASPECT_RATIO_SELECTOR_LABELS } from './aspectRatio.js';

const _qs = (() => {
	const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
	return v ? `?v=${encodeURIComponent(v)}` : '';
})();
const [{ attachAutoGrowTextarea }, { loadMutateQueue, removeFromMutateQueueByImageUrl }, { createImagePickerModalDom, wireImagePickerModal }] =
	await Promise.all([
		import(`./autogrow.js${_qs}`),
		import(`./mutateQueue.js${_qs}`),
		import(`./imagePickerModal.js${_qs}`)
	]);

// --- Field type detection (used to choose handler) ---

export function isPromptLikeField(fieldKey, field) {
	const key = String(fieldKey || '');
	const label = String(field?.label || '');
	return /prompt/i.test(key) || /prompt/i.test(label);
}

export function isMultilineField(fieldKey, field) {
	const type = typeof field?.type === 'string' ? field.type.toLowerCase() : '';
	if (type === 'textarea' || type === 'multiline') return true;
	if (field?.multiline === true) return true;
	if (type === '' || type === 'text' || type === 'string') {
		return isPromptLikeField(fieldKey, field);
	}
	return false;
}

// --- Label (shared across field types) ---

function createLabel(fieldKey, field, { labelClassName, requiredClassName, fieldIdPrefix }) {
	const label = document.createElement('label');
	label.className = labelClassName;
	label.htmlFor = `${fieldIdPrefix}${fieldKey}`;
	label.appendChild(document.createTextNode(field.label || fieldKey));
	if (field.required) {
		const required = document.createElement('span');
		required.className = requiredClassName;
		required.textContent = ' *';
		label.appendChild(required);
	}
	return label;
}

// --- Field type handlers ---
// Each handler(fieldKey, field, context) returns the input/textarea element.
// Context: { inputClassName, fieldIdPrefix, onValueChange, selectClassName? }.
// Handler must set id, name, className, required, value and attach listeners that call onValueChange(fieldKey, value).

function createColorField(fieldKey, field, context) {
	const { inputClassName, fieldIdPrefix, onValueChange } = context;
	const input = document.createElement('input');
	input.type = 'color';
	input.id = `${fieldIdPrefix}${fieldKey}`;
	input.name = fieldKey;
	input.className = inputClassName;
	input.value = typeof field.default === 'string' ? field.default : '#000000';
	if (field.required) input.required = true;

	const notify = (value) => onValueChange(fieldKey, value);
	notify(input.value);
	input.addEventListener('change', (e) => notify(e.target.value));
	input.addEventListener('input', (e) => notify(e.target.value));
	return input;
}

function createTextareaField(fieldKey, field, context) {
	const { inputClassName, fieldIdPrefix, onValueChange } = context;
	const input = document.createElement('textarea');
	input.id = `${fieldIdPrefix}${fieldKey}`;
	input.name = fieldKey;
	input.className = isPromptLikeField(fieldKey, field) ? `${inputClassName} prompt-editor` : inputClassName;
	input.placeholder = field.label || fieldKey;
	input.rows = typeof field.rows === 'number' && field.rows > 0 ? field.rows : 3;
	if (field.required) input.required = true;

	attachAutoGrowTextarea(input);

	const notify = (value) => onValueChange(fieldKey, value);
	notify(input.value);
	input.addEventListener('input', (e) => notify(e.target.value));
	return input;
}

function createTextField(fieldKey, field, context) {
	const { inputClassName, fieldIdPrefix, onValueChange } = context;
	const input = document.createElement('input');
	input.type = field.type || 'text';
	input.id = `${fieldIdPrefix}${fieldKey}`;
	input.name = fieldKey;
	input.className = inputClassName;
	input.placeholder = field.label || fieldKey;
	if (field.required) input.required = true;

	const defaultValue = typeof field?.default === 'string' ? field.default : '';
	if (defaultValue) input.value = defaultValue;

	const notify = (value) => onValueChange(fieldKey, value);
	notify(input.value);
	input.addEventListener('input', (e) => notify(e.target.value));
	input.addEventListener('change', (e) => notify(e.target.value));
	return input;
}

/**
 * Normalize field.options to an array of { value, label }.
 * Accepts: string[] or { value?, id?, label? }[].
 */
function normalizeSelectOptions(options) {
	if (!Array.isArray(options)) return [];
	return options.map((item) => {
		if (typeof item === 'string') {
			return { value: item, label: item, hint: '' };
		}
		if (item && typeof item === 'object') {
			const value = item.value ?? item.id ?? item.label ?? '';
			const label = item.label ?? item.value ?? item.id ?? String(value);
			const hint = typeof item.hint === 'string' ? item.hint : '';
			return { value: String(value), label: String(label), hint };
		}
		return { value: '', label: '', hint: '' };
	});
}

/** Short labels for grok-imagine aspect ratio selector (matches competitor UI). */
function resolveAspectRatioOptionLabel(value, optionLabel, optionHint) {
	const key = String(value || '').trim();
	if (optionHint && String(optionHint).trim()) return String(optionHint).trim();
	if (ASPECT_RATIO_SELECTOR_LABELS[key]) return ASPECT_RATIO_SELECTOR_LABELS[key];
	if (optionLabel && String(optionLabel).trim() && String(optionLabel).trim() !== key) {
		return String(optionLabel).trim();
	}
	return key;
}

function aspectShapeDimensions(w, h, max = 40) {
	if (w >= h) {
		return { width: max, height: Math.max(4, Math.round((max * h) / w)) };
	}
	return { width: Math.max(4, Math.round((max * w) / h)), height: max };
}

function createAspectRatioSelectorField(fieldKey, field, context) {
	const { fieldIdPrefix, onValueChange } = context;
	const options = normalizeSelectOptions(field.options || []).filter((opt) => opt.value);
	const defaultValue =
		field.default !== undefined && field.default !== null ? String(field.default) : options[0]?.value || '';

	const hiddenInput = document.createElement('input');
	hiddenInput.type = 'hidden';
	hiddenInput.id = `${fieldIdPrefix}${fieldKey}`;
	hiddenInput.name = fieldKey;
	hiddenInput.value = defaultValue;
	if (field.required) hiddenInput.required = true;

	const group = document.createElement('div');
	group.className = 'aspect-ratio-selector';
	group.setAttribute('role', 'radiogroup');
	group.setAttribute('aria-labelledby', `${fieldIdPrefix}${fieldKey}-label`);

	const notify = (value) => onValueChange(fieldKey, value);

	const setSelected = (value) => {
		const next = String(value || '');
		hiddenInput.value = next;
		group.querySelectorAll('.aspect-ratio-option').forEach((btn) => {
			const isSelected = btn.getAttribute('data-value') === next;
			btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
			btn.classList.toggle('is-selected', isSelected);
		});
		notify(next);
	};

	options.forEach(({ value, label, hint }) => {
		const parsed = parseAspectRatioString(value);
		if (!parsed) return;

		const [w, h] = parsed;
		const dims = aspectShapeDimensions(w, h);
		const shortLabel = resolveAspectRatioOptionLabel(value, label, hint);

		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'aspect-ratio-option';
		btn.setAttribute('role', 'radio');
		btn.setAttribute('data-value', value);
		btn.setAttribute('aria-label', `${value} ${shortLabel}`);

		const ratioEl = document.createElement('span');
		ratioEl.className = 'aspect-ratio-option-ratio';
		ratioEl.textContent = value;

		const shapeEl = document.createElement('span');
		shapeEl.className = 'aspect-ratio-option-shape';
		shapeEl.setAttribute('aria-hidden', 'true');
		const shapeInner = document.createElement('span');
		shapeInner.className = 'aspect-ratio-option-shape-inner';
		shapeInner.style.width = `${dims.width}px`;
		shapeInner.style.height = `${dims.height}px`;
		shapeEl.appendChild(shapeInner);

		const labelEl = document.createElement('span');
		labelEl.className = 'aspect-ratio-option-label';
		labelEl.textContent = shortLabel;

		btn.appendChild(ratioEl);
		btn.appendChild(shapeEl);
		btn.appendChild(labelEl);

		btn.addEventListener('click', () => setSelected(value));
		btn.addEventListener('keydown', (e) => {
			if (e.key === ' ' || e.key === 'Enter') {
				e.preventDefault();
				setSelected(value);
			}
		});

		group.appendChild(btn);
	});

	const wrapper = document.createElement('div');
	wrapper.className = 'aspect-ratio-selector-wrap';
	wrapper.appendChild(hiddenInput);
	wrapper.appendChild(group);

	setSelected(defaultValue);
	return wrapper;
}

function createSelectField(fieldKey, field, context) {
	const { fieldIdPrefix, onValueChange } = context;
	const selectClassName = context.selectClassName ?? context.inputClassName;
	const select = document.createElement('select');
	select.id = `${fieldIdPrefix}${fieldKey}`;
	select.name = fieldKey;
	select.className = selectClassName;
	if (field.required) select.required = true;

	const options = normalizeSelectOptions(field.options || []);
	const defaultValue = field.default !== undefined && field.default !== null ? String(field.default) : '';

	options.forEach(({ value, label, hint }) => {
		const option = document.createElement('option');
		option.value = value;
		option.textContent = label;
		if (hint) option.dataset.hint = hint;
		if (value === defaultValue) option.selected = true;
		select.appendChild(option);
	});

	const notify = (value) => onValueChange(fieldKey, value);
	notify(select.value);
	select.addEventListener('change', (e) => notify(e.target.value));
	return select;
}

function createBooleanField(fieldKey, field, context) {
	const { fieldIdPrefix, onValueChange } = context;
	const input = document.createElement('input');
	input.type = 'checkbox';
	input.name = fieldKey;
	input.className = 'form-switch-input';
	input.setAttribute('aria-hidden', 'true');
	input.setAttribute('tabindex', '-1');
	if (field.required) input.required = true;

	const defaultValue = field.default === true || field.default === 'true';
	input.checked = defaultValue;

	const wrapper = document.createElement('div');
	wrapper.id = `${fieldIdPrefix}${fieldKey}`;
	wrapper.className = 'form-switch';
	wrapper.setAttribute('role', 'switch');
	wrapper.setAttribute('aria-checked', String(input.checked));
	wrapper.setAttribute('tabindex', '0');
	wrapper.setAttribute('aria-label', field.label || fieldKey);

	const track = document.createElement('span');
	track.className = 'form-switch-track';
	const thumb = document.createElement('span');
	thumb.className = 'form-switch-thumb';
	track.appendChild(thumb);
	wrapper.appendChild(input);
	wrapper.appendChild(track);

	const notify = (value) => onValueChange(fieldKey, value);
	notify(input.checked);

	const updateAria = () => wrapper.setAttribute('aria-checked', String(input.checked));

	const handleChange = () => {
		updateAria();
		notify(input.checked);
	};

	input.addEventListener('change', handleChange);

	wrapper.addEventListener('click', (e) => {
		if (e.target === input) return;
		e.preventDefault();
		input.checked = !input.checked;
		updateAria();
		notify(input.checked);
	});

	wrapper.addEventListener('keydown', (e) => {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			input.checked = !input.checked;
			updateAria();
			notify(input.checked);
		}
	});

	return wrapper;
}

function createImageField(fieldKey, field, context) {
	const { inputClassName, fieldIdPrefix, onValueChange } = context;
	const defaultValue = typeof field?.default === 'string' ? field.default : '';
	let initialValue = defaultValue;
	if (!initialValue && typeof window !== 'undefined' && window.location?.pathname === '/create') {
		try {
			const queued = loadMutateQueue();
			const first = queued.find((item) => typeof item?.imageUrl === 'string' && item.imageUrl.trim());
			if (first) {
				initialValue = first.imageUrl.trim();
			}
		} catch {
			// ignore storage errors
		}
	}

	const wrapper = document.createElement('div');
	wrapper.className = 'image-field image-field-multi';

	const thumbPlaceholder = document.createElement('button');
	thumbPlaceholder.type = 'button';
	thumbPlaceholder.className = 'image-thumb-placeholder';
	thumbPlaceholder.setAttribute('aria-label', 'Choose image');
	thumbPlaceholder.textContent = 'Click To Choose';
	wrapper.appendChild(thumbPlaceholder);

	const thumbContainer = document.createElement('div');
	thumbContainer.className = 'image-thumb-container';
	thumbContainer.setAttribute('data-image-thumb-container', '');
	thumbContainer.hidden = true;
	const thumbWrap = document.createElement('div');
	thumbWrap.className = 'image-thumb-wrap loading';
	thumbWrap.title = 'Preview';
	const thumbImg = document.createElement('img');
	thumbImg.className = 'image-thumb';
	thumbImg.alt = '';
	thumbWrap.appendChild(thumbImg);
	const removeBtn = document.createElement('button');
	removeBtn.type = 'button';
	removeBtn.className = 'image-pick-another';
	removeBtn.textContent = 'Remove';
	thumbContainer.appendChild(thumbWrap);
	thumbContainer.appendChild(removeBtn);
	wrapper.appendChild(thumbContainer);

	const pickerRefs = createImagePickerModalDom(inputClassName);
	wrapper.appendChild(pickerRefs.modalOverlay);
	const { urlInput, modalError, fileInput } = pickerRefs;

	const hiddenInput = document.createElement('input');
	hiddenInput.type = 'hidden';
	hiddenInput.id = `${fieldIdPrefix}${fieldKey}`;
	hiddenInput.name = fieldKey;
	hiddenInput.value = typeof initialValue === 'string' ? initialValue : '';
	if (field.required) hiddenInput.required = true;
	wrapper.appendChild(hiddenInput);

	const errorEl = document.createElement('p');
	errorEl.className = 'image-field-error';
	errorEl.setAttribute('role', 'alert');
	errorEl.setAttribute('aria-live', 'polite');
	errorEl.hidden = true;
	wrapper.appendChild(errorEl);

	function setError(msg) {
		errorEl.textContent = msg || '';
		errorEl.hidden = !msg;
		modalError.textContent = msg || '';
		modalError.hidden = !msg;
	}

	let currentObjectUrl = null;

	function revokeObjectUrl() {
		if (currentObjectUrl) {
			URL.revokeObjectURL(currentObjectUrl);
			currentObjectUrl = null;
		}
	}

	function setValue(url) {
		revokeObjectUrl();
		const v = (url || '').trim();
		hiddenInput.value = v;
		urlInput.value = v;
		onValueChange(fieldKey, v);
		if (v) {
			thumbPlaceholder.hidden = true;
			thumbContainer.hidden = false;
			setThumbSrc(v);
		} else {
			thumbPlaceholder.hidden = false;
			thumbContainer.hidden = true;
			thumbImg.removeAttribute('src');
		}
	}

	function setFile(file) {
		if (!file || !(file instanceof File)) return;
		revokeObjectUrl();
		hiddenInput.value = '';
		urlInput.value = '';
		onValueChange(fieldKey, file);
		thumbPlaceholder.hidden = true;
		thumbContainer.hidden = false;
		currentObjectUrl = URL.createObjectURL(file);
		setThumbSrc(currentObjectUrl);
		setError('');
	}

	function setThumbSrc(src) {
		if (!src) return;
		thumbWrap.classList.add('loading');
		thumbWrap.classList.remove('loaded', 'error');
		thumbImg.style.opacity = '0';
		thumbImg.onload = () => {
			thumbWrap.classList.remove('loading');
			thumbWrap.classList.add('loaded');
			thumbImg.style.opacity = '';
		};
		thumbImg.onerror = () => {
			thumbWrap.classList.remove('loading');
			thumbWrap.classList.add('loaded', 'error');
			thumbImg.style.opacity = '';
		};
		thumbImg.src = src;
		thumbImg.loading = 'lazy';
		thumbImg.decoding = 'async';
	}

	function clearValue() {
		const prevUrl = (hiddenInput.value || urlInput.value || '').trim();
		revokeObjectUrl();
		hiddenInput.value = '';
		urlInput.value = '';
		thumbPlaceholder.hidden = false;
		thumbContainer.hidden = true;
		thumbImg.removeAttribute('src');
		fileInput.value = '';
		setError('');
		onValueChange(fieldKey, '');
		if (prevUrl && typeof window !== 'undefined' && window.location?.pathname === '/create') {
			try {
				removeFromMutateQueueByImageUrl(prevUrl);
			} catch {
				// ignore storage errors
			}
		}
	}

	const { openModal: openPickerUi } = wireImagePickerModal(pickerRefs, {
		detachOnClose: false,
		onPick: (value) => {
			if (typeof value === 'string') setValue(value);
			else setFile(value);
		},
		setModalAlert: setError
	});

	thumbPlaceholder.addEventListener('click', () => openPickerUi());
	removeBtn.addEventListener('click', () => clearValue());

	const hasInitial = typeof initialValue === 'string' && initialValue.trim().length > 0;
	urlInput.value = typeof initialValue === 'string' ? initialValue : '';
	thumbPlaceholder.hidden = !!hasInitial;
	thumbContainer.hidden = !hasInitial;
	const initialNotify =
		typeof initialValue === 'string'
			? initialValue
			: initialValue instanceof File
				? initialValue
				: (hiddenInput.value || '').trim();
	onValueChange(fieldKey, initialNotify);

	if (initialValue && typeof initialValue === 'string') {
		setThumbSrc(initialValue);
	}

	return wrapper;
}

/**
 * Parse default value for image_url_array: array of URLs or JSON string.
 */
function parseImageArrayDefault(defaultValue) {
	if (Array.isArray(defaultValue)) {
		return defaultValue.filter((v) => typeof v === 'string' && v.trim());
	}
	if (typeof defaultValue === 'string' && defaultValue.trim()) {
		try {
			const parsed = JSON.parse(defaultValue);
			return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string' && v.trim()) : [];
		} catch {
			return [];
		}
	}
	return [];
}

function createImageArrayField(fieldKey, field, context) {
	const { inputClassName, fieldIdPrefix, onValueChange } = context;
	const defaultArr = parseImageArrayDefault(field?.default);
	let initialItems = [...defaultArr];
	if (initialItems.length === 0 && typeof window !== 'undefined' && window.location?.pathname === '/create') {
		try {
			const queued = loadMutateQueue();
			const urls = queued
				.map((item) => (typeof item?.imageUrl === 'string' ? item.imageUrl.trim() : ''))
				.filter(Boolean);
			if (urls.length) {
				initialItems = urls;
			}
		} catch {
			// ignore storage errors
		}
	}

	const wrapper = document.createElement('div');
	wrapper.className = 'image-field image-field-multi image-field-array';

	// Match single-image structure: a "thumb container" that owns the visible UI
	const thumbContainer = document.createElement('div');
	thumbContainer.className = 'image-thumb-container image-array-container';
	thumbContainer.setAttribute('data-image-thumb-container', '');

	const listEl = document.createElement('div');
	listEl.className = 'image-array-list';
	listEl.setAttribute('data-image-array-list', '');

	const addBtn = document.createElement('button');
	addBtn.type = 'button';
	addBtn.className = 'image-thumb-placeholder image-array-add';
	addBtn.textContent = 'Add image';
	addBtn.setAttribute('aria-label', 'Add image');

	thumbContainer.appendChild(listEl);
	listEl.appendChild(addBtn);
	wrapper.appendChild(thumbContainer);

	const hiddenInput = document.createElement('input');
	hiddenInput.type = 'hidden';
	hiddenInput.id = `${fieldIdPrefix}${fieldKey}`;
	hiddenInput.name = fieldKey;
	if (field.required) hiddenInput.required = true;
	wrapper.appendChild(hiddenInput);

	// Match single-image error element (even if you don’t use it yet)
	const errorEl = document.createElement('p');
	errorEl.className = 'image-field-error';
	errorEl.setAttribute('role', 'alert');
	errorEl.setAttribute('aria-live', 'polite');
	errorEl.hidden = true;
	wrapper.appendChild(errorEl);

	// Optional helper if you later want to surface validation failures
	function setError(msg) {
		errorEl.textContent = msg || '';
		errorEl.hidden = !msg;
	}

	const objectUrls = new Map();

	function revokeObjectUrlForIndex(i) {
		const url = objectUrls.get(i);
		if (url) {
			URL.revokeObjectURL(url);
			objectUrls.delete(i);
		}
	}

	function getDisplayUrl(item) {
		if (typeof item === 'string' && item.trim()) return item.trim();
		if (item instanceof File) return null;
		return null;
	}

	function getThumbSrc(item, index) {
		const url = getDisplayUrl(item);
		if (url) return url;
		if (item instanceof File) {
			let objUrl = objectUrls.get(index);
			if (!objUrl) {
				objUrl = URL.createObjectURL(item);
				objectUrls.set(index, objUrl);
			}
			return objUrl;
		}
		return '';
	}

	let items = [...initialItems];

	function syncHiddenInput() {
		// Keep parity with existing behavior: only serialize when all are URL strings.
		const allStrings = items.every((v) => typeof v === 'string' && v.trim());
		hiddenInput.value = allStrings ? JSON.stringify(items.map((v) => v.trim())) : '';
	}

	function setItems(next) {
		items.forEach((_, i) => revokeObjectUrlForIndex(i));
		objectUrls.clear();
		items = next;
		syncHiddenInput();
		onValueChange(fieldKey, items);
		renderList();
	}

	function removeAt(index) {
		const prev = items[index];
		const prevUrl = typeof prev === 'string' ? prev.trim() : '';
		revokeObjectUrlForIndex(index);
		objectUrls.clear();
		items = items.filter((_, i) => i !== index);
		syncHiddenInput();
		onValueChange(fieldKey, items);
		renderList();
		if (prevUrl && typeof window !== 'undefined' && window.location?.pathname === '/create') {
			try {
				removeFromMutateQueueByImageUrl(prevUrl);
			} catch {
				// ignore storage errors
			}
		}
	}

	function moveLeftAt(index) {
		if (index <= 0 || index >= items.length) return;
		const next = [...items];
		[next[index - 1], next[index]] = [next[index], next[index - 1]];
		setItems(next);
	}

	function renderList() {
		listEl.innerHTML = '';
		items.forEach((item, index) => {
			const src = getThumbSrc(item, index);

			const wrap = document.createElement('div');
			wrap.className = 'image-array-item';

			const thumbWrap = document.createElement('div');
			thumbWrap.className = 'image-thumb-wrap loaded';

			const img = document.createElement('img');
			img.className = 'image-thumb';
			img.alt = '';
			if (src) img.src = src;

			thumbWrap.appendChild(img);

			if (index > 0) {
				const moveLeftBtn = document.createElement('button');
				moveLeftBtn.type = 'button';
				moveLeftBtn.className = 'image-array-move-left';
				moveLeftBtn.setAttribute('aria-label', 'Move left');
				moveLeftBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';
				moveLeftBtn.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					moveLeftAt(index);
				});
				thumbWrap.appendChild(moveLeftBtn);
			}

			const removeBtn = document.createElement('button');
			removeBtn.type = 'button';
			removeBtn.className = 'image-pick-another';
			removeBtn.textContent = 'Remove';
			removeBtn.addEventListener('click', () => removeAt(index));

			wrap.appendChild(thumbWrap);
			wrap.appendChild(removeBtn);
			listEl.appendChild(wrap);
		});
		listEl.appendChild(addBtn);
	}

	addBtn.addEventListener('click', () => {
		setError('');
		openImagePickerModal({
			onSelect(value) {
				items = [...items, value];
				syncHiddenInput();
				onValueChange(fieldKey, items);
				renderList();
			}
		});
	});

	syncHiddenInput();
	onValueChange(fieldKey, items);
	renderList();

	return wrapper;
}

/**
 * Open the same "Choose image" modal used by image fields (Paste image / Paste link / Upload file).
 * Call onSelect with the chosen image as string (URL) or File, then closes the modal.
 * @param {{ onSelect: (value: string | File) => void }} options
 */
export function openImagePickerModal({ onSelect }) {
	const refs = createImagePickerModalDom('form-input');
	document.body.appendChild(refs.modalOverlay);
	const { openModal } = wireImagePickerModal(refs, {
		detachOnClose: true,
		onPick: onSelect
	});
	openModal();
}

// --- Handler resolution ---

const FIELD_HANDLERS = {
	color: createColorField,
	textarea: createTextareaField,
	text: createTextField,
	select: createSelectField,
	aspect_ratio_selector: createAspectRatioSelectorField,
	boolean: createBooleanField,
	image: createImageField,
	image_array: createImageArrayField
};

/**
 * Returns true when the field config has type 'image_url' (image URL input + upload/paste).
 * Used to look up the handler in FIELD_HANDLERS.
 */
export function isImageUrlField(field) {
	return field?.type === 'image_url';
}

/**
 * Returns true when the field config has type 'image_url_array' (array of image URLs).
 */
export function isImageUrlArrayField(field) {
	return field?.type === 'image_url_array';
}

export function getFieldType(fieldKey, field, context) {
	if (
		fieldKey === 'aspect_ratio' &&
		field?.type === 'select' &&
		shouldUseAspectRatioSelector(context)
	) {
		return 'aspect_ratio_selector';
	}
	if (field?.type === 'color') return 'color';
	if (field?.type === 'select') return 'select';
	if (field?.type === 'boolean') return 'boolean';
	if (isImageUrlField(field)) return 'image';
	if (isImageUrlArrayField(field)) return 'image_array';
	if (isMultilineField(fieldKey, field)) return 'textarea';
	return 'text';
}

/**
 * Create an input/textarea for a single field from provider config.
 * Uses the appropriate handler for the field type.
 *
 * @param {string} fieldKey - Field key from config
 * @param {object} field - Field config { type, label, required, rows?, default?, options? (for select) }
 * @param {object} context - { inputClassName, fieldIdPrefix, onValueChange, selectClassName? }
 * @returns {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement}
 */
export function createFieldInput(fieldKey, field, context) {
	const formContext = context?.formContext ?? context;
	const type = getFieldType(fieldKey, field, formContext);
	const handler = FIELD_HANDLERS[type] || FIELD_HANDLERS.text;
	return handler(fieldKey, field, context);
}

// --- Main render ---

const DEFAULTS = {
	inputClassName: 'form-input',
	labelClassName: 'form-label',
	requiredClassName: 'field-required',
	fieldIdPrefix: 'field-',
	selectClassName: 'form-select'
};

/** Stable order: non-image fields first (config order), then image / image_array—config key order alone varies per method on the server. */
function sortedProviderFieldKeys(fields, context) {
	const keys = Object.keys(fields);
	const imageKeys = [];
	const restKeys = [];
	for (const fieldKey of keys) {
		const field = fields[fieldKey];
		const t = getFieldType(fieldKey, field, context);
		if (t === 'image' || t === 'image_array') imageKeys.push(fieldKey);
		else restKeys.push(fieldKey);
	}
	return [...restKeys, ...imageKeys];
}

/**
 * Render form fields from a provider method's fields config into a container.
 * Each field type is handled by a dedicated handler (color, textarea, text, select, boolean).
 *
 * @param {HTMLElement} container - Element to append form-group divs into (e.g. data-fields-container)
 * @param {object} fields - Method fields config, e.g. method.fields from server_config
 * @param {object} options - Optional overrides
 * @param {function(string, string): void} options.onFieldChange - Called (fieldKey, value) when any field changes and once per field with initial value
 * @param {string} [options.inputClassName] - Class for inputs
 * @param {string} [options.selectClassName] - Class for select elements (default 'form-select')
 * @param {string} [options.labelClassName] - Class for labels
 * @param {string} [options.requiredClassName] - Class for required asterisk span
 * @param {string} [options.fieldIdPrefix] - Prefix for input id/for (default 'field-')
 * @param {{ serverId?: unknown, methodKey?: unknown, modelValue?: unknown }} [options.formContext] - Server/method/model for conditional field UI
 */
export function renderFields(container, fields, options = {}) {
	if (!container || !fields || typeof fields !== 'object') return;

	const opts = { ...DEFAULTS, ...options };
	const formContext = opts.formContext && typeof opts.formContext === 'object' ? opts.formContext : null;
	const fieldKeys = sortedProviderFieldKeys(fields, formContext);
	if (fieldKeys.length === 0) return;

	container.innerHTML = '';

	fieldKeys.forEach((fieldKey) => {
		const field = fields[fieldKey];
		if (fieldKey === 'aspect_ratio' && !shouldUseAspectRatioSelector(formContext)) {
			return;
		}
		const fieldGroup = document.createElement('div');
		const type = getFieldType(fieldKey, field, formContext);
		fieldGroup.className = type === 'boolean' ? 'form-group form-group-checkbox' : 'form-group';
		fieldGroup.setAttribute('data-field-key', fieldKey);
		const isProviderHidden = field && (field.hidden === true || field.hidden === 'true');
		if (isProviderHidden && fieldKey !== 'aspect_ratio') {
			fieldGroup.classList.add('field-hidden');
			fieldGroup.setAttribute('data-field-hidden', 'true');
		}

		const label = createLabel(fieldKey, type === 'image' ? { ...field, label: 'Image' } : type === 'image_array' ? { ...field, label: field?.label || 'Images' } : field, {
			labelClassName: opts.labelClassName,
			requiredClassName: opts.requiredClassName,
			fieldIdPrefix: opts.fieldIdPrefix
		});
		if (type === 'aspect_ratio_selector') {
			label.id = `${opts.fieldIdPrefix}${fieldKey}-label`;
		}
		const input = createFieldInput(fieldKey, field, {
			inputClassName: opts.inputClassName,
			selectClassName: opts.selectClassName,
			fieldIdPrefix: opts.fieldIdPrefix,
			onValueChange: opts.onFieldChange,
			formContext
		});

		fieldGroup.appendChild(label);
		fieldGroup.appendChild(input);

		// For select fields, show a muted hint below the field when options provide hints.
		if (type === 'select' && Array.isArray(field?.options) && field.options.length > 0) {
			const normalizedOptions = normalizeSelectOptions(field.options);
			const hasHints = normalizedOptions.some((opt) => opt.hint);
			if (hasHints && input && input.tagName === 'SELECT') {
				const hintEl = document.createElement('p');
				hintEl.className = 'form-hint';

				const updateHint = () => {
					const currentValue = input.value;
					const match = normalizedOptions.find((opt) => String(opt.value) === String(currentValue));
					const text = match?.hint || field?.hint || '';
					hintEl.textContent = text;
					hintEl.hidden = !text;
				};

				updateHint();
				input.addEventListener('change', updateHint);
				fieldGroup.appendChild(hintEl);
			}
		}

		container.appendChild(fieldGroup);
	});
}
