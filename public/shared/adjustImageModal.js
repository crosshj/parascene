/**
 * Adjust Image — brightness / contrast / saturation with live preview.
 * Preview uses CSS filters (non-destructive). Save bakes filters to a PNG via canvas.
 */

const html = String.raw;

const DEFAULT_VALUE = 100;
const MIN_VALUE = 0;
const MAX_VALUE = 200;

/** @type {HTMLElement | null} */
let modalRoot = null;
/** @type {AdjustImageModalDeps | null} */
let activeDeps = null;
/** @type {{ brightness: number, contrast: number, saturation: number }} */
let values = { brightness: DEFAULT_VALUE, contrast: DEFAULT_VALUE, saturation: DEFAULT_VALUE };
let previewReady = false;
/** @type {HTMLImageElement | null} */
let sourceImage = null;
/** @type {string | null} */
let sourceObjectUrl = null;

/**
 * @typedef {object} AdjustImageModalDeps
 * @property {string} imageUrl
 * @property {number} sourceId
 * @property {(file: File, adjustments: { brightness: number, contrast: number, saturation: number }) => Promise<void>} onSave
 * @property {(message: string) => void} showToast
 */

export function clampAdjustValue(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return DEFAULT_VALUE;
	return Math.max(MIN_VALUE, Math.min(MAX_VALUE, Math.round(v)));
}

export function buildCssFilter({ brightness, contrast, saturation }) {
	const b = clampAdjustValue(brightness) / 100;
	const c = clampAdjustValue(contrast) / 100;
	const s = clampAdjustValue(saturation) / 100;
	return `brightness(${b}) contrast(${c}) saturate(${s})`;
}

export function adjustmentsAreDefault(adj) {
	return (
		clampAdjustValue(adj?.brightness) === DEFAULT_VALUE &&
		clampAdjustValue(adj?.contrast) === DEFAULT_VALUE &&
		clampAdjustValue(adj?.saturation) === DEFAULT_VALUE
	);
}

/**
 * Bake adjustments onto a source image and return a PNG File.
 * @param {CanvasImageSource} image
 * @param {{ brightness: number, contrast: number, saturation: number }} adjustments
 * @param {number} sourceId
 * @returns {Promise<File>}
 */
export async function bakeAdjustedImageFile(image, adjustments, sourceId) {
	const w = Number(image.naturalWidth || image.width || 0);
	const h = Number(image.naturalHeight || image.height || 0);
	if (!(w > 0 && h > 0)) {
		throw new Error('Image is not available');
	}
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not create canvas');
	ctx.filter = buildCssFilter(adjustments);
	ctx.drawImage(image, 0, 0, w, h);
	ctx.filter = 'none';
	const blob = await new Promise((resolve, reject) => {
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/png');
	});
	const id = Number(sourceId);
	const name = Number.isFinite(id) && id > 0 ? `adjusted-${id}.png` : 'adjusted.png';
	return new File([blob], name, { type: 'image/png' });
}

/**
 * Fetch image pixels (same-origin / credentialed) so canvas bake is not CORS-tainted.
 * Caller must revoke `objectUrl` when done.
 * @param {string} imageUrl
 * @returns {Promise<{ image: HTMLImageElement, objectUrl: string }>}
 */
export async function loadImageForAdjust(imageUrl) {
	const url = typeof imageUrl === 'string' ? imageUrl.trim() : '';
	if (!url) throw new Error('Image is not available');

	const res = await fetch(url, { credentials: 'include', cache: 'force-cache' });
	if (!res.ok) throw new Error('Could not load image');
	const blob = await res.blob();
	if (!blob || !String(blob.type || '').startsWith('image/')) {
		throw new Error('Could not load image');
	}
	const objectUrl = URL.createObjectURL(blob);
	try {
		const image = await new Promise((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = () => reject(new Error('Could not decode image'));
			el.src = objectUrl;
		});
		return { image, objectUrl };
	} catch (err) {
		URL.revokeObjectURL(objectUrl);
		throw err;
	}
}

function releaseSourceImage() {
	sourceImage = null;
	if (sourceObjectUrl) {
		URL.revokeObjectURL(sourceObjectUrl);
		sourceObjectUrl = null;
	}
}

function getModalElements() {
	if (!modalRoot) return null;
	return {
		overlay: modalRoot,
		preview: modalRoot.querySelector('[data-adjust-image-preview]'),
		brightness: modalRoot.querySelector('[data-adjust-brightness]'),
		contrast: modalRoot.querySelector('[data-adjust-contrast]'),
		saturation: modalRoot.querySelector('[data-adjust-saturation]'),
		brightnessValue: modalRoot.querySelector('[data-adjust-brightness-value]'),
		contrastValue: modalRoot.querySelector('[data-adjust-contrast-value]'),
		saturationValue: modalRoot.querySelector('[data-adjust-saturation-value]'),
		status: modalRoot.querySelector('[data-adjust-image-status]'),
		saveBtn: modalRoot.querySelector('[data-adjust-image-save]'),
		resetBtn: modalRoot.querySelector('[data-adjust-image-reset]'),
		cancelBtn: modalRoot.querySelector('[data-adjust-image-cancel]'),
		closeBtn: modalRoot.querySelector('[data-adjust-image-close]'),
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

function setSaveEnabled(enabled) {
	const { saveBtn } = getModalElements() || {};
	if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = !enabled;
}

function updateSaveButtonState() {
	setSaveEnabled(previewReady && !adjustmentsAreDefault(values));
}

function applyPreviewFilter() {
	const { preview } = getModalElements() || {};
	if (!(preview instanceof HTMLImageElement)) return;
	preview.style.filter = buildCssFilter(values);
}

function syncSliderUi() {
	const els = getModalElements();
	if (!els) return;
	const map = [
		['brightness', els.brightness, els.brightnessValue],
		['contrast', els.contrast, els.contrastValue],
		['saturation', els.saturation, els.saturationValue],
	];
	for (const [key, input, label] of map) {
		const v = values[key];
		if (input instanceof HTMLInputElement) input.value = String(v);
		if (label instanceof HTMLElement) label.textContent = String(v);
	}
	applyPreviewFilter();
	updateSaveButtonState();
}

function setModalBusy(busy) {
	const els = getModalElements();
	if (!els) return;
	els.overlay?.classList.toggle('is-busy', Boolean(busy));
	const { saveBtn, resetBtn, cancelBtn, closeBtn, brightness, contrast, saturation } = els;
	if (saveBtn instanceof HTMLButtonElement) {
		if (busy) {
			saveBtn.disabled = true;
			if (!saveBtn.querySelector('.adjust-image-btn-spinner')) {
				saveBtn.insertAdjacentHTML('afterbegin', '<span class="adjust-image-btn-spinner" aria-hidden="true"></span>');
			}
			const label = saveBtn.querySelector('.adjust-image-btn-label');
			if (label) label.textContent = 'Saving…';
		} else {
			saveBtn.querySelector('.adjust-image-btn-spinner')?.remove();
			const label = saveBtn.querySelector('.adjust-image-btn-label');
			if (label) label.textContent = 'Save';
			updateSaveButtonState();
		}
	}
	if (resetBtn instanceof HTMLButtonElement) resetBtn.disabled = busy;
	if (cancelBtn instanceof HTMLButtonElement) cancelBtn.disabled = busy;
	if (closeBtn instanceof HTMLButtonElement) closeBtn.disabled = busy;
	for (const input of [brightness, contrast, saturation]) {
		if (input instanceof HTMLInputElement) input.disabled = busy || !previewReady;
	}
}

function resetValues() {
	values = { brightness: DEFAULT_VALUE, contrast: DEFAULT_VALUE, saturation: DEFAULT_VALUE };
	syncSliderUi();
	setModalStatus('');
}

function closeAdjustImageModal() {
	if (!modalRoot) return;
	modalRoot.classList.remove('open', 'is-preview-loading', 'is-busy');
	modalRoot.setAttribute('aria-hidden', 'true');
	document.body.style.overflow = '';
	activeDeps = null;
	releaseSourceImage();
	previewReady = false;
	const { preview } = getModalElements() || {};
	if (preview instanceof HTMLImageElement) {
		preview.removeAttribute('src');
		preview.style.filter = '';
	}
	setModalBusy(false);
	setModalStatus('');
}

function ensureModalDom() {
	if (modalRoot) return modalRoot;
	const root = document.createElement('div');
	root.className = 'creation-detail-adjust-image-overlay';
	root.setAttribute('data-adjust-image-modal', '');
	root.setAttribute('aria-hidden', 'true');
	root.innerHTML = html`
		<div class="creation-detail-adjust-image-dialog" role="dialog" aria-modal="true" aria-labelledby="adjust-image-title">
			<div class="creation-detail-adjust-image-header">
				<h2 id="adjust-image-title" class="creation-detail-adjust-image-title">Adjust Image</h2>
				<button type="button" class="creation-detail-adjust-image-close" data-adjust-image-close aria-label="Close">×</button>
			</div>
			<div class="creation-detail-adjust-image-preview-wrap">
				<img class="creation-detail-adjust-image-preview" data-adjust-image-preview alt="Adjustment preview" />
			</div>
			<div class="creation-detail-adjust-image-sliders">
				<label class="creation-detail-adjust-image-slider-row">
					<span class="creation-detail-adjust-image-slider-label">Brightness</span>
					<input type="range" data-adjust-brightness min="${MIN_VALUE}" max="${MAX_VALUE}" step="1" value="${DEFAULT_VALUE}" aria-label="Brightness" disabled />
					<span class="creation-detail-adjust-image-slider-value" data-adjust-brightness-value>${DEFAULT_VALUE}</span>
				</label>
				<label class="creation-detail-adjust-image-slider-row">
					<span class="creation-detail-adjust-image-slider-label">Contrast</span>
					<input type="range" data-adjust-contrast min="${MIN_VALUE}" max="${MAX_VALUE}" step="1" value="${DEFAULT_VALUE}" aria-label="Contrast" disabled />
					<span class="creation-detail-adjust-image-slider-value" data-adjust-contrast-value>${DEFAULT_VALUE}</span>
				</label>
				<label class="creation-detail-adjust-image-slider-row">
					<span class="creation-detail-adjust-image-slider-label">Saturation</span>
					<input type="range" data-adjust-saturation min="${MIN_VALUE}" max="${MAX_VALUE}" step="1" value="${DEFAULT_VALUE}" aria-label="Saturation" disabled />
					<span class="creation-detail-adjust-image-slider-value" data-adjust-saturation-value>${DEFAULT_VALUE}</span>
				</label>
			</div>
			<p class="creation-detail-adjust-image-status" data-adjust-image-status role="status" hidden></p>
			<div class="creation-detail-adjust-image-footer">
				<button type="button" class="btn-secondary" data-adjust-image-cancel>Cancel</button>
				<button type="button" class="btn-secondary" data-adjust-image-reset>Reset</button>
				<button type="button" class="btn-primary" data-adjust-image-save disabled>
					<span class="adjust-image-btn-label">Save</span>
				</button>
			</div>
		</div>
	`;
	modalRoot = root;
	document.body.appendChild(root);
	wireModalEvents(root);
	return root;
}

function onSliderInput(key, raw) {
	values = { ...values, [key]: clampAdjustValue(raw) };
	syncSliderUi();
}

function wireModalEvents(root) {
	root.addEventListener('click', (e) => {
		if (e.target === root) closeAdjustImageModal();
	});
	const els = getModalElements();
	els?.cancelBtn?.addEventListener('click', (e) => {
		e.preventDefault();
		closeAdjustImageModal();
	});
	els?.closeBtn?.addEventListener('click', (e) => {
		e.preventDefault();
		closeAdjustImageModal();
	});
	els?.resetBtn?.addEventListener('click', (e) => {
		e.preventDefault();
		resetValues();
	});

	const bindSlider = (input, key) => {
		if (!(input instanceof HTMLInputElement)) return;
		input.addEventListener('input', () => onSliderInput(key, input.value));
		input.addEventListener('change', () => onSliderInput(key, input.value));
	};
	bindSlider(els?.brightness, 'brightness');
	bindSlider(els?.contrast, 'contrast');
	bindSlider(els?.saturation, 'saturation');

	els?.saveBtn?.addEventListener('click', async (e) => {
		e.preventDefault();
		const deps = activeDeps;
		const btn = els?.saveBtn;
		if (!deps || !(btn instanceof HTMLButtonElement) || btn.disabled) return;
		if (!(sourceImage instanceof HTMLImageElement)) {
			setModalStatus('Image is not available', true);
			return;
		}
		if (adjustmentsAreDefault(values)) return;

		setModalStatus('');
		setModalBusy(true);
		try {
			const file = await bakeAdjustedImageFile(sourceImage, values, deps.sourceId);
			await deps.onSave(file, { ...values });
			closeAdjustImageModal();
		} catch (err) {
			setModalBusy(false);
			setModalStatus(err?.message || 'Could not save adjusted image', true);
		}
	});

	if (root.dataset.keydownBound !== '1') {
		root.dataset.keydownBound = '1';
		document.addEventListener('keydown', (ev) => {
			if (!modalRoot?.classList.contains('open') || ev.key !== 'Escape') return;
			ev.preventDefault();
			if (modalRoot.classList.contains('is-busy')) return;
			closeAdjustImageModal();
		});
	}
}

/**
 * @param {AdjustImageModalDeps} deps
 */
export function openAdjustImageModal(deps) {
	const imageUrl = typeof deps?.imageUrl === 'string' ? deps.imageUrl.trim() : '';
	const sourceId = Number(deps?.sourceId);
	if (!imageUrl || !Number.isFinite(sourceId) || sourceId <= 0) return;
	if (typeof deps?.onSave !== 'function') return;

	ensureModalDom();
	activeDeps = deps;
	releaseSourceImage();
	previewReady = false;
	resetValues();
	setSaveEnabled(false);
	setModalBusy(false);
	setModalStatus('Loading image…');
	modalRoot?.classList.add('is-preview-loading', 'open');
	modalRoot?.setAttribute('aria-hidden', 'false');
	document.body.style.overflow = 'hidden';

	const { preview, brightness, contrast, saturation } = getModalElements() || {};
	for (const input of [brightness, contrast, saturation]) {
		if (input instanceof HTMLInputElement) input.disabled = true;
	}

	void (async () => {
		try {
			const loaded = await loadImageForAdjust(imageUrl);
			if (activeDeps !== deps) {
				URL.revokeObjectURL(loaded.objectUrl);
				return;
			}
			sourceImage = loaded.image;
			sourceObjectUrl = loaded.objectUrl;
			if (preview instanceof HTMLImageElement) {
				preview.src = loaded.objectUrl;
				preview.style.filter = buildCssFilter(values);
			}
			previewReady = true;
			modalRoot?.classList.remove('is-preview-loading');
			setModalStatus('');
			for (const input of [brightness, contrast, saturation]) {
				if (input instanceof HTMLInputElement) input.disabled = false;
			}
			updateSaveButtonState();
		} catch (err) {
			if (activeDeps !== deps) return;
			setModalStatus(err?.message || 'Could not load image', true);
			modalRoot?.classList.remove('is-preview-loading');
		}
	})();
}

export function isAdjustImageModalOpen() {
	return Boolean(modalRoot?.classList.contains('open'));
}
