import { showOccupancyConfirm } from '../../shared/gpuOccupancy.js';
import * as createPageRuntimeModule from '../../shared/createPageRuntime.js';
import * as ProviderFieldsModule from '../../components/ProviderFields/ProviderFields.js';
import * as mutateQueueSyncModule from '../../shared/mutateQueueSync.js';
import * as triggeredSuggestModule from '../../shared/triggeredSuggest.js';
import * as promptFieldClearModule from '../../shared/promptFieldClear.js';
import * as createStylesModule from '../../shared/createStyles.js';
import * as generationDefaultsModule from '../../shared/generationDefaults.js';
import '../../elements/tabs.js';
import * as autogrowModule from '../../shared/autogrow.js';
import * as createSettingsSyncModule from '../../shared/createSettingsSync.js';
import * as importMediaEntryModule from '../../shared/importMediaEntry.js';
import { reportSubmissionError } from './SubmissionFeedback.js';
import { createWorkflowLifetime } from './lifetime.js';
/**
 * Basic create workflow: style cards, prompts, submit buttons, native overlay mount.
 * Advanced create lives in app-route-create; this module only serves basic overlay.
 */


function runCreatePageInit(root, lifetime, refreshAutoGrowTextareas, createSettingsSyncMod = {}, createProvider) {
 const fetch = (url, options = {}) => createProvider.api.request(url, { ...options, signal: lifetime.signal });
	const persistSharedStyleSelected =
		typeof createSettingsSyncMod.persistSharedStyleSelected === 'function'
			? createSettingsSyncMod.persistSharedStyleSelected
			: null;
	const notifyCreateSettingsUpdated =
		typeof createSettingsSyncMod.notifyCreateSettingsUpdated === 'function'
			? createSettingsSyncMod.notifyCreateSettingsUpdated
			: null;
	if (
		!root.classList.contains('create-workflow-root') &&
		!document.body.classList.contains('create-page') &&
		!document.body.classList.contains('create-page-advanced')
	) return;
	let submitInProgress = false;
	let savedFormReady = false;
 let writingDraft = false;
	const BASIC_CREATE_DEFAULT_SERVER_ID = 1;
	const BASIC_CREATE_DEFAULT_METHOD_KEY = 'replicate';
	const BASIC_CREATE_DEFAULT_MODEL = 'xai/grok-imagine-image';
	const BASIC_IMAGE_EDIT_CARRYOVER_KEY = 'create_page_image_edit_carryover';
	const BASIC_IMAGE_EDIT_SELECTION_KEY = 'create_page_image_edit_selection';


	function isOnCreatePage() {
		return (
			document.body.classList.contains('create-page') ||
			root.classList.contains('create-page')
		);
	}

	async function afterCreateOverlaySubmit(result) {
		if (!result?.id || !lifetime.active) return;
		const runtimeMod = createPageRuntimeModule;
		if (lifetime.active) runtimeMod.refreshAfterSubmit({ creationId: result.id });
	}

	const changeLink = root.querySelector('#create-change-image-link');
	const area = root.querySelector('.create-image-edit-area');
	/** @type {string|File|null} */
	let imageEditValue = null;

	function parseStoredImageEditUrl(raw) {
		if (typeof raw !== 'string') return '';
		const trimmed = raw.trim();
		if (!trimmed) return '';
		if (trimmed.startsWith('[')) {
			try {
				const parsed = JSON.parse(trimmed);
				if (Array.isArray(parsed)) {
					const first = parsed.find((u) => typeof u === 'string' && u.trim());
					return first ? first.trim() : '';
				}
			} catch (_) {}
			return '';
		}
		return trimmed;
	}

	function isUsableImagePreviewUrl(url) {
		if (typeof url !== 'string' || !url.trim()) return false;
		const t = url.trim();
		if (t.startsWith('blob:') || t.startsWith('data:image/')) return true;
		if (/^https?:\/\//i.test(t)) return true;
		return t.startsWith('/') && !t.startsWith('//');
	}

	function clearImageEditPreview({ fromQueueSync = false } = {}) {
		const box = area?.closest('.create-image-edit-box');
		if (!box || !area) return;
		imageEditValue = null;
		delete box.dataset.imageValue;
		const thumb = box.querySelector('.create-image-edit-thumb');
		if (thumb?.src?.startsWith('blob:')) URL.revokeObjectURL(thumb.src);
		thumb?.remove();
		area.querySelector('.create-image-edit-placeholder')?.classList.remove('is-hidden');
		changeLink?.classList.remove('is-visible');
		try {
			localStorage.removeItem(BASIC_IMAGE_EDIT_SELECTION_KEY);
		} catch (_) {}

		if (typeof updateEditImageButtonState === 'function') updateEditImageButtonState();
		if (savedFormReady && !fromQueueSync) createProvider.workflow.edit({ imageChange: { type: 'removeFirst' } });
		saveCurrentForm();
	}

	function applyImageEditSelection(value) {
		const box = area?.closest('.create-image-edit-box');
		if (!box || !area) return;
		const prevThumb = box.querySelector('.create-image-edit-thumb');
		if (prevThumb?.src?.startsWith('blob:')) {
			URL.revokeObjectURL(prevThumb.src);
		}
		let thumbSrc = null;
		if (value instanceof File) {
			imageEditValue = value;
			box.dataset.imageValue = value.name;
			thumbSrc = URL.createObjectURL(value);
		} else if (typeof value === 'string') {
			const url = parseStoredImageEditUrl(value);
			if (!url || !isUsableImagePreviewUrl(url)) {
				clearImageEditPreview();
				return;
			}
			imageEditValue = url;
			box.dataset.imageValue = url;
			thumbSrc = url;
		} else {
			clearImageEditPreview();
			return;
		}
		if (!thumbSrc) return;
		let thumb = prevThumb || box.querySelector('.create-image-edit-thumb');
		if (!thumb) {
			thumb = document.createElement('img');
			thumb.className = 'create-image-edit-thumb';
			thumb.alt = '';
			area.insertBefore(thumb, area.firstChild);
		}
		thumb.onerror = () => clearImageEditPreview({ fromQueueSync: true });
		thumb.src = thumbSrc;
		thumb.hidden = false;
		area.querySelector('.create-image-edit-placeholder')?.classList.add('is-hidden');
		changeLink?.classList.add('is-visible');
		if (typeof updateEditImageButtonState === 'function') updateEditImageButtonState();
		saveCurrentForm();
	}

	function openImagePicker() {

		(({ openImagePickerModal }) => {
 if (!lifetime.active) return;
			openImagePickerModal({
				async onSelect(value) {
     try {
      const saved = await createProvider.workflow.selectImages(value, { first: true, signal: lifetime.signal });
      if (!saved || !lifetime.active) return;
      const next = saved.inputImages[0];
      applyImageEditSelection(next);
      persistBasicImageSelection(next);
     } catch (error) { reportSubmissionError(error, lifetime.active); }
    },
			});
		})(ProviderFieldsModule);
	}

	function persistBasicImageSelection(url) {
		const trimmed = typeof url === 'string' ? url.trim() : '';
		if (!trimmed) return;

		try {
			localStorage.setItem(BASIC_IMAGE_EDIT_SELECTION_KEY, trimmed);
			localStorage.setItem('create_page_tab', 'image-edit');
		} catch (_) {}
	}

 function getQueueHeadUrl() { return createProvider.draft.read().inputImages[0] || ''; }
 function hasBasicMutateImageSource() { return Boolean(getQueueHeadUrl()) || Boolean(imageEditValue); }

	if (area) {
		lifetime.listen(area, 'click', () => {
			if (!area.querySelector('.create-image-edit-placeholder.is-hidden')) openImagePicker();
		});
		lifetime.listen(area, 'keydown', (e) => {
			if ((e.key === 'Enter' || e.key === ' ') && !area.querySelector('.create-image-edit-placeholder.is-hidden')) {
				e.preventDefault();
				openImagePicker();
			}
		});
	}
	if (changeLink) {
		lifetime.listen(changeLink, 'click', (e) => {
			e.preventDefault();
			openImagePicker();
		});
	}

	const STORAGE_KEYS = {
		tab: 'create_page_tab',
		promptText: 'create_page_prompt_text',
		promptImageEdit: 'create_page_prompt_image_edit',
		styleIndex: 'create_page_style_index',
		styleSelected: 'create_page_style_selected',
	};
	const tabsEl = root.querySelector('.create-content app-tabs');
	const promptInputs = root.querySelectorAll('.create-content .create-prompt-input');
	const textToImagePrompt = promptInputs[0];
	const imageEditPrompt = promptInputs[1];
	function saveCurrentForm() {
		if (!savedFormReady || !lifetime.active || writingDraft) return;
		const imageEdit = tabsEl?.getAttribute('active') === 'image-edit';
		const image = imageEditValue || getQueueHeadUrl();
		const url = imageEdit && typeof image === 'string' ? image : '';
  writingDraft = true;
  try { createProvider.workflow.enterMode({ mode: imageEdit ? 'image-edit' : 'basic',
   prompt: (imageEdit ? imageEditPrompt : textToImagePrompt)?.value || '',
   aspectRatio: createSettingsSyncMod.getSharedAspectRatio?.() || '1:1' });
  } finally { writingDraft = false; }
	}
	lifetime.listen(root, 'click', async (event) => {
		const link = event.target.closest?.('.create-switch-to-advanced');
		if (!link) return;
		event.preventDefault();
		event.stopImmediatePropagation();
  try { await createProvider.workflow.flushImages(); } catch (error) { reportSubmissionError(error, lifetime.active); return; }
  if (!lifetime.active) return;
		saveCurrentForm();
		if (tabsEl?.getAttribute('active') !== 'image-edit') {
			createPageRuntimeModule.switchCreateEditorMode('advanced', event);
			return;
		}
		let imageUrl = imageEditValue || getQueueHeadUrl();
		if (imageUrl instanceof File) imageUrl = await createProvider.workflow.uploadFile(imageUrl);
		if (!lifetime.active) return;
		if (imageUrl) {
			const snapshot = { mode: 'image-to-image', imageUrl, prompt: imageEditPrompt?.value || '',
				aspectRatio: createSettingsSyncMod.getSharedAspectRatio?.() || '1:1' };
			const route = mutateQueueSyncModule.syncMutatePageToAdvancedCreate(snapshot);
		}
		createPageRuntimeModule.switchCreateEditorMode('advanced', event);
	}, true);
	const styleCards = root.querySelector('.create-content .create-style-cards');
	const styleColumns = styleCards ? styleCards.querySelectorAll('.create-style-column') : [];

	function saveTab(id) {
		try {
			localStorage.setItem(STORAGE_KEYS.tab, String(id || ''));
		} catch (_) {}
		saveCurrentForm();
	}
	function savePrompts() {
		try {
			const textValue = textToImagePrompt?.value || '';
			const editValue = imageEditPrompt?.value || '';
			if (textToImagePrompt) localStorage.setItem(STORAGE_KEYS.promptText, textValue);
			if (imageEditPrompt) localStorage.setItem(STORAGE_KEYS.promptImageEdit, editValue);
			const unified = editValue.trim() || textValue;
			localStorage.setItem('create_page_prompt', unified);
			notifyCreateSettingsUpdated?.();
		} catch (_) {}
		saveCurrentForm();
	}
	function saveStyleIndex(index) {
		try {
			localStorage.setItem(STORAGE_KEYS.styleIndex, String(index ?? ''));
		} catch (_) {}
	}
	function saveStyleSelected(value) {
  createProvider.workflow.edit({ styleKey: String(value ?? '') });
		try {
			if (persistSharedStyleSelected) persistSharedStyleSelected(String(value ?? ''));
			else localStorage.setItem(STORAGE_KEYS.styleSelected, String(value ?? ''));
		} catch (_) {}
		saveCurrentForm();
	}

	// Selection is per card (two cards per column). Clicking a card does not move scroll (original behavior).
	function selectCard(card) {
		const key = card?.getAttribute('data-key');
		if (!key) return;
		const section = root.querySelector('.create-content .create-style-section');
		const cards = section?.querySelectorAll('.create-style-card');
		if (cards?.length) {
			cards.forEach((c) => c.classList.remove('is-selected'));
			card.classList.add('is-selected');
		}
		saveStyleSelected(key);
	}

	if (tabsEl) {
		const savedTabId = (() => {
			try {
				return localStorage.getItem(STORAGE_KEYS.tab) || '';
			} catch {
				return '';
			}
		})();
		if (savedTabId && typeof tabsEl.setActiveTab === 'function') {
			tabsEl.setActiveTab(savedTabId, { focus: false });
		}
		const onTabChanged = (e) => {
   const prompt = createProvider.draft.read().fieldValues.prompt;
   if (prompt !== undefined) { if (textToImagePrompt) textToImagePrompt.value = prompt; if (imageEditPrompt) imageEditPrompt.value = prompt; }
			const id = e.detail?.id;
   if (savedFormReady && id !== 'image-edit') createProvider.workflow.selectTextToImage();
			saveTab(id);
   saveCurrentForm();
		};
		// app-tabs emits `tab-change`; keep legacy listener too for compatibility.
		lifetime.listen(tabsEl, 'tab-change', onTabChanged);
		lifetime.listen(tabsEl, 'app-tabs-change', onTabChanged);
	}

	if (textToImagePrompt || imageEditPrompt) {
		try {
			const savedPrompt = createSettingsSyncMod.getSharedCreatePrompt?.() ?? createSettingsSyncMod.readSharedCreateSettings().prompt;
   const savedText = savedPrompt;
   const savedImageEdit = savedPrompt;
			if (textToImagePrompt && typeof savedText === 'string') textToImagePrompt.value = savedText;
			if (imageEditPrompt && typeof savedImageEdit === 'string') imageEditPrompt.value = savedImageEdit;
		} catch {}
		try {
			refreshAutoGrowTextareas(root);
		} catch (_) {}
		let promptSaveTimer;
		function schedulePromptSave() {
   const active = tabsEl?.getAttribute('active') === 'image-edit' ? imageEditPrompt : textToImagePrompt;
   const prompt = active?.value || '';
   if (textToImagePrompt) textToImagePrompt.value = prompt;
   if (imageEditPrompt) imageEditPrompt.value = prompt;
			saveCurrentForm();
			clearTimeout(promptSaveTimer);
			promptSaveTimer = lifetime.defer(savePrompts, 300);
		}
		[textToImagePrompt, imageEditPrompt].filter(Boolean).forEach((el) => {
			lifetime.listen(el, 'input', () => {
				schedulePromptSave();
				refreshAutoGrowTextareas(root);
			});
			lifetime.listen(el, 'change', schedulePromptSave);
		});
	}

	// @mention suggestions on prompt fields (restored from pre-4d5956d)
	savedFormReady = true;
 saveCurrentForm();


	try {
(({ attachMentionSuggest }) => {
 if (!lifetime.active) return;
		root.querySelectorAll('.create-content .create-prompt-input').forEach((el) => attachMentionSuggest(el));
	})(triggeredSuggestModule);
} catch (error) {
(() => {})(error);
}

	// Prompt clear link and is-empty state (restored from pre-4d5956d)
	try {
(({ attachPromptFieldClearAll }) => {
 if (!lifetime.active) return;
			attachPromptFieldClearAll(root.querySelector('.create-content'), {
				afterClear: () => {
					try {
						refreshAutoGrowTextareas(root);
					} catch (_) {}
				},
			});
		})(promptFieldClearModule);
} catch (error) {
(() => {})(error);
}

	// Style thumbnails and data-style-value on columns (restored from pre-4d5956d entry-create.js)
	const styleSection = root.querySelector('.create-content .create-style-section');
	const allStyleCards = styleSection?.querySelectorAll('.create-style-card');
	if (allStyleCards?.length && isOnCreatePage()) {
		allStyleCards.forEach((card, i) => {
			if (!card.hasAttribute('data-color-index')) {
				card.setAttribute('data-color-index', String(i % 9));
			}
		});

		(({ getStyleThumbUrl }) => {
 if (!lifetime.active) return;
			allStyleCards.forEach((card) => {
				if (card.querySelector('.create-style-card-thumb')) return;
				const key = card.getAttribute('data-key');
				if (!key) return;
				const url = key === 'none' ? '/assets/style-thumbs/none.webp' : getStyleThumbUrl(key);
				if (!url) return;
				const img = document.createElement('img');
				img.className = 'create-style-card-thumb';
				img.src = url;
				img.width = 140;
				img.height = 160;
				img.loading = 'lazy';
				img.decoding = 'async';
				img.alt = '';
				card.insertBefore(img, card.firstChild);
			});
			styleColumns.forEach((col) => {
				const firstCard = col.querySelector('.create-style-card[data-key]');
				if (firstCard?.getAttribute('data-key')) col.dataset.styleValue = firstCard.getAttribute('data-key');
			});
		})(createStylesModule);
	}

	// Scroll carousel to column and sync dots (restored from pre-4d5956d)
	function scrollToStyleColumnAndUpdateDots(index) {
		if (!styleCards || !styleColumns.length) return;
		const step = styleColumns[0].offsetWidth + (parseFloat(getComputedStyle(styleCards).gap) || 12);
		const i = Math.max(0, Math.min(index, styleColumns.length - 1));
		styleCards.scrollLeft = i * step;
		const dotsWrap = styleCards.closest('.create-style-section')?.querySelector('.create-style-dots');
		const dots = dotsWrap?.querySelectorAll('.create-style-dot');
		if (dots?.length) {
			const activeStart = Math.max(0, Math.min(i, styleColumns.length - 4));
			dots.forEach((d, j) => d.classList.toggle('is-active', j >= activeStart && j < activeStart + 4));
		}
	}

	if (styleCards && styleColumns.length) {
		const savedStyleSelected = (() => {
			try {
				return (createProvider.draft.read().styleKey ?? localStorage.getItem(STORAGE_KEYS.styleSelected) ?? '').trim();
			} catch {
				return '';
			}
		})();
		const savedStyleIndex = (() => {
			try {
				const n = parseInt(localStorage.getItem(STORAGE_KEYS.styleIndex), 10);
				return isNaN(n) ? null : n;
			} catch {
				return null;
			}
		})();

		// Restore selection and scroll position (original: run once on load, scroll does not happen on card click)
		const run = () => {
			let scrollIndex = null;
			if (savedStyleSelected) {
				const selectedCard = Array.from(styleCards.querySelectorAll('.create-style-card')).find(
					(c) => c.getAttribute('data-key') === savedStyleSelected
				);
				if (selectedCard) {
					const column = selectedCard.closest('.create-style-column');
					if (column) {
						scrollIndex = Array.from(styleColumns).indexOf(column);
						if (scrollIndex >= 0) selectedCard.classList.add('is-selected');
					}
				}
			}
			if (!styleCards.querySelector('.create-style-card.is-selected')) {
				const noneCard = Array.from(styleCards.querySelectorAll('.create-style-card')).find(
					(c) => c.getAttribute('data-key') === 'none'
				);
				if (noneCard) {
					noneCard.classList.add('is-selected');
					const column = noneCard.closest('.create-style-column');
					if (column) scrollIndex = Array.from(styleColumns).indexOf(column);
				}
			}
			if (scrollIndex == null && savedStyleIndex != null && savedStyleIndex >= 0) {
				scrollIndex = savedStyleIndex;
			}
			if (scrollIndex != null) scrollToStyleColumnAndUpdateDots(scrollIndex);
		};
		lifetime.frame(() => lifetime.frame(run));

		// Card click: select the clicked card only (no scroll)
		const section = root.querySelector('.create-content .create-style-section');
		section?.querySelectorAll('.create-style-card[data-key]').forEach((card) => {
			lifetime.listen(card, 'click', () => selectCard(card));
		});

		// Save scroll position when user scrolls (do not change which card is selected)
		let styleSaveTimer;
		function scheduleStyleSave() {
			clearTimeout(styleSaveTimer);
			styleSaveTimer = lifetime.defer(() => {
				if (!styleCards || !styleColumns.length) return;
				const step = styleColumns[0].offsetWidth + (parseFloat(getComputedStyle(styleCards).gap) || 12);
				const index = Math.round(styleCards.scrollLeft / step);
				const i = Math.max(0, Math.min(index, styleColumns.length - 1));
				saveStyleIndex(i);
				const dotsWrap = styleCards.closest('.create-style-section')?.querySelector('.create-style-dots');
				const dots = dotsWrap?.querySelectorAll('.create-style-dot');
				if (dots?.length) {
					const activeStart = Math.max(0, Math.min(i, styleColumns.length - 4));
					dots.forEach((d, j) => d.classList.toggle('is-active', j >= activeStart && j < activeStart + 4));
				}
			}, 200);
		}
		lifetime.listen(styleCards, 'scroll', scheduleStyleSave, { passive: true });
		if ('scrollend' in styleCards) lifetime.listen(styleCards, 'scrollend', scheduleStyleSave);
	}

	// Create Image / Edit Image button state and submit (restored from pre-4d5956d entry-create.js)
	const generateButtons = root.querySelectorAll('.create-content .create-btn-generate');
	const createImageBtn = generateButtons[0];
	const editImageBtn = generateButtons[1];

	function getSelectedStyleKey() {
		const section = root.querySelector('.create-content .create-style-section');
		const selected = section?.querySelector('.create-style-card.is-selected');
		if (selected) return selected.getAttribute('data-key') || 'none';
		try {
			const saved = createProvider.draft.read().styleKey ?? localStorage.getItem(STORAGE_KEYS.styleSelected);
			return (saved || 'none').trim();
		} catch {
			return 'none';
		}
	}

	function updateCreateImageButtonState() {
		if (!createImageBtn) return;
		const hasPrompt = (textToImagePrompt?.value || '').trim().length > 0;
		createImageBtn.disabled = !hasPrompt || submitInProgress || !['idle', 'error'].includes(createProvider.workflow.getSnapshot().phase);
	}
	updateCreateImageButtonState();
	if (textToImagePrompt) {
		lifetime.listen(textToImagePrompt, 'input', updateCreateImageButtonState);
		lifetime.listen(textToImagePrompt, 'change', updateCreateImageButtonState);
	}

	async function submitBasic(mode) {
  if (!lifetime.active || submitInProgress) return;
  saveCurrentForm();
  submitInProgress = true;
  if (createImageBtn) createImageBtn.disabled = true;
  if (editImageBtn) editImageBtn.disabled = true;
  try {
   const styleKey = getSelectedStyleKey();
   const result = await createProvider.workflow.submit({ mode, navigate: 'none',
    styleKey: mode === 'basic' && styleKey !== 'none' ? styleKey : undefined },
    { signal: lifetime.signal, confirm: question => question.kind === 'occupancy' ? showOccupancyConfirm(question.occupancy, question.options) : window.confirm(question.message) });
   await afterCreateOverlaySubmit(result);
  } catch (error) { reportSubmissionError(error, lifetime.active); }
  finally {
   submitInProgress = false;
   if (lifetime.active) { if (createImageBtn) createImageBtn.disabled = false; updateEditImageButtonState(); }
  }
 }
 if (createImageBtn) lifetime.listen(createImageBtn, 'click', () => {
  if ((textToImagePrompt?.value || '').trim()) return submitBasic('basic');
 });

	const mutateOptions = { serverId: null, methodKey: null };
	async function loadMutateOptions() {

		const { MUTATE_DEFAULT_SERVER_ID, MUTATE_DEFAULT_METHOD_KEY } = generationDefaultsModule;
		mutateOptions.serverId = MUTATE_DEFAULT_SERVER_ID;
		mutateOptions.methodKey = MUTATE_DEFAULT_METHOD_KEY;
	}

	function updateEditImageButtonState() {
		if (!editImageBtn) return;
		const hasImage = hasBasicMutateImageSource();
		const hasPrompt = (imageEditPrompt?.value || '').trim().length > 0;
		const hasMutate = Boolean(mutateOptions.serverId && mutateOptions.methodKey);
		editImageBtn.disabled = !hasImage || !hasPrompt || !hasMutate || submitInProgress || !['idle', 'error'].includes(createProvider.workflow.getSnapshot().phase);
	}
	
 lifetime.own(createProvider.draft.subscribe(saved => {
  if (!lifetime.active || writingDraft) return;
  const prompt = saved.fieldValues.prompt;
  if (prompt !== undefined) { if (textToImagePrompt) textToImagePrompt.value = prompt; if (imageEditPrompt) imageEditPrompt.value = prompt; }
  const image = saved.inputImages[0] || '';
  if (image !== imageEditValue) {
   writingDraft = true;
   try { if (image) applyImageEditSelection(image); else clearImageEditPreview({ fromQueueSync: true }); }
   finally { writingDraft = false; }
  }
  refreshAutoGrowTextareas(root);
 }));
 lifetime.own(createProvider.workflow.subscribe(() => { updateCreateImageButtonState(); updateEditImageButtonState(); }));
	void loadMutateOptions().then(() => updateEditImageButtonState());
	if (imageEditPrompt) {
		lifetime.listen(imageEditPrompt, 'input', updateEditImageButtonState);
		lifetime.listen(imageEditPrompt, 'change', updateEditImageButtonState);
	}

	if (editImageBtn) lifetime.listen(editImageBtn, 'click', () => {
  if ((imageEditPrompt?.value || '').trim() && hasBasicMutateImageSource()) return submitBasic('image-edit');
 });
}

/**
 * Native overlay mount for basic create (cookie create_editor=simple).
 * @param {HTMLElement} root
 * @param {{ markup?: string }} [opts]
 * @returns {Promise<() => void>}
 */
export async function mountBasicCreateWorkflow(root, opts = {}) {
	if (!(root instanceof HTMLElement)) return () => {};
	
	const markup = typeof opts.markup === 'string' && opts.markup.trim()
		? opts.markup
		: '';
	if (!markup) return () => {};

	const { refreshAutoGrowTextareas } = autogrowModule;
	const createSettingsSyncMod = createSettingsSyncModule;
	const runtimeMod = createPageRuntimeModule;
	if (!root.isConnected) return () => {};
 const lifetime = opts.lifetime || createWorkflowLifetime();
 if (!lifetime.active) return () => {};
 const tpl = document.createElement('template');
 tpl.innerHTML = markup;
 root.replaceChildren(tpl.content.cloneNode(true));
	await customElements.whenDefined('app-tabs');
 if (!lifetime.active) return () => {};
	runtimeMod.bindCreatePageEmbedNavigation();
	runtimeMod.bindCreatePageEmbedEscape(() => {
		return Boolean(root.querySelector('[data-import-suno-modal]'));
	});
	runCreatePageInit(root, lifetime, refreshAutoGrowTextareas, createSettingsSyncMod, opts.createProvider);
	const { bindImportSunoEntry } = importMediaEntryModule;
	if (!lifetime.active) return () => {};
 lifetime.own(await bindImportSunoEntry(root, opts.createProvider));
 if (!lifetime.active) return () => {};
	return () => {
  if (!lifetime.active) return;
		lifetime.destroy();
  root.querySelectorAll('img').forEach(img => { if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src); });
  root.replaceChildren();
	};
}
