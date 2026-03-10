/**
 * Create page: nav, nav-mobile, modals, tabs (create.html), route-create (createAdvanced.html).
 * Also runs create-page-specific wiring (image picker, localStorage, style cards, submit buttons).
 * Imports are dynamic with cache-busting (version) so components are not served from cache.
 */

// Only wait for above-the-fold / interactive shell; modals hydrate in background.
// Basic create (create.html) does not mount app-route-create; only advanced (createAdvanced.html) does.
// So we only wait for app-route-create on advanced — otherwise a failing route-create load would block runCreatePageInit on basic.
const TAGS_BASIC = ['app-navigation', 'app-navigation-mobile', 'app-tabs'];
const TAGS_ADVANCED = [...TAGS_BASIC, 'app-route-create'];

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

export async function init(version) {
	const qs = getImportQuery(version);
	await Promise.all([
		import(`../../components/navigation/index.js${qs}`),
		import(`../../components/navigation/mobile.js${qs}`),
		import(`../../components/modals/profile.js${qs}`),
		import(`../../components/modals/credits.js${qs}`),
		import(`../../components/modals/notifications.js${qs}`),
		import(`../../components/modals/server.js${qs}`),
		import(`../../components/elements/tabs.js${qs}`),
		import(`../../components/routes/create.js${qs}`),
	]);
	const { waitForComponents } = await import(`../../shared/pageInit.js${qs}`);
	const { refreshAutoGrowTextareas } = await import(`../../shared/autogrow.js${qs}`);
	const isAdvanced = document.body.classList.contains('create-page-advanced');
	await waitForComponents(isAdvanced ? TAGS_ADVANCED : TAGS_BASIC);
	runCreatePageInit(refreshAutoGrowTextareas);
}

function runCreatePageInit(refreshAutoGrowTextareas) {
	if (!document.body.classList.contains('create-page') && !document.body.classList.contains('create-page-advanced')) return;

	const changeLink = document.getElementById('create-change-image-link');
	const area = document.querySelector('.create-image-edit-area');
	/** @type {string|File|null} */
	let imageEditValue = null;

	function openImagePicker() {
		const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
		const qs = v ? `?v=${encodeURIComponent(v)}` : '';
		import(`../../shared/providerFormFields.js${qs}`).then(({ openImagePickerModal }) => {
			openImagePickerModal({
				onSelect(value) {
					const box = area?.closest('.create-image-edit-box');
					if (!box) return;
					imageEditValue = value instanceof File || typeof value === 'string' ? value : null;
					const prevThumb = box.querySelector('.create-image-edit-thumb');
					if (prevThumb?.src?.startsWith('blob:')) {
						URL.revokeObjectURL(prevThumb.src);
					}
					box.dataset.imageValue = value instanceof File ? value.name : value;
					const thumbSrc = typeof value === 'string' ? value : value instanceof File ? URL.createObjectURL(value) : null;
					if (thumbSrc && area) {
						let thumb = prevThumb || box.querySelector('.create-image-edit-thumb');
						if (!thumb) {
							thumb = document.createElement('img');
							thumb.className = 'create-image-edit-thumb';
							thumb.alt = '';
							area.insertBefore(thumb, area.firstChild);
						}
						thumb.src = thumbSrc;
						thumb.hidden = false;
						area.querySelector('.create-image-edit-placeholder')?.classList.add('is-hidden');
						changeLink?.classList.add('is-visible');
					}
					if (typeof updateEditImageButtonState === 'function') updateEditImageButtonState();
				},
			});
		});
	}

	if (area) {
		area.addEventListener('click', () => {
			if (!area.querySelector('.create-image-edit-placeholder.is-hidden')) openImagePicker();
		});
		area.addEventListener('keydown', (e) => {
			if ((e.key === 'Enter' || e.key === ' ') && !area.querySelector('.create-image-edit-placeholder.is-hidden')) {
				e.preventDefault();
				openImagePicker();
			}
		});
	}
	if (changeLink) {
		changeLink.addEventListener('click', (e) => {
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
	const tabsEl = document.querySelector('.create-content app-tabs');
	const promptInputs = document.querySelectorAll('.create-content .create-prompt-input');
	const textToImagePrompt = promptInputs[0];
	const imageEditPrompt = promptInputs[1];
	const styleCards = document.querySelector('.create-content .create-style-cards');
	const styleColumns = styleCards ? styleCards.querySelectorAll('.create-style-column') : [];

	function saveTab(id) {
		try {
			localStorage.setItem(STORAGE_KEYS.tab, String(id || ''));
		} catch (_) {}
	}
	function savePrompts() {
		try {
			if (textToImagePrompt) localStorage.setItem(STORAGE_KEYS.promptText, textToImagePrompt.value || '');
			if (imageEditPrompt) localStorage.setItem(STORAGE_KEYS.promptImageEdit, imageEditPrompt.value || '');
		} catch (_) {}
	}
	function saveStyleIndex(index) {
		try {
			localStorage.setItem(STORAGE_KEYS.styleIndex, String(index ?? ''));
		} catch (_) {}
	}
	function saveStyleSelected(value) {
		try {
			localStorage.setItem(STORAGE_KEYS.styleSelected, String(value ?? ''));
		} catch (_) {}
	}

	// Selection is per card (two cards per column). Clicking a card does not move scroll (original behavior).
	function selectCard(card) {
		const key = card?.getAttribute('data-key');
		if (!key) return;
		const section = document.querySelector('.create-content .create-style-section');
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
		tabsEl.addEventListener('app-tabs-change', (e) => {
			const id = e.detail?.id;
			saveTab(id);
		});
	}

	if (textToImagePrompt || imageEditPrompt) {
		try {
			const savedText = localStorage.getItem(STORAGE_KEYS.promptText);
			const savedImageEdit = localStorage.getItem(STORAGE_KEYS.promptImageEdit);
			if (textToImagePrompt && typeof savedText === 'string') textToImagePrompt.value = savedText;
			if (imageEditPrompt && typeof savedImageEdit === 'string') imageEditPrompt.value = savedImageEdit;
		} catch {}
		try {
			refreshAutoGrowTextareas(document);
		} catch (_) {}
		let promptSaveTimer;
		function schedulePromptSave() {
			clearTimeout(promptSaveTimer);
			promptSaveTimer = setTimeout(savePrompts, 300);
		}
		[textToImagePrompt, imageEditPrompt].filter(Boolean).forEach((el) => {
			el.addEventListener('input', () => {
				schedulePromptSave();
				refreshAutoGrowTextareas();
			});
			el.addEventListener('change', schedulePromptSave);
		});
	}

	// @mention suggestions on prompt fields (restored from pre-4d5956d)
	const createPromptQs = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
	const createPromptQsParam = createPromptQs ? `?v=${encodeURIComponent(createPromptQs)}` : '';
	import(`../../shared/triggeredSuggest.js${createPromptQsParam}`).then(({ attachMentionSuggest }) => {
		document.querySelectorAll('.create-content .create-prompt-input').forEach((el) => attachMentionSuggest(el));
	}).catch(() => {});

	// Prompt clear link and is-empty state (restored from pre-4d5956d)
	document.querySelectorAll('.create-content .create-prompt-wrap').forEach((wrap) => {
		const field = wrap.querySelector('.create-prompt-input');
		const clearLink = wrap.querySelector('.create-prompt-clear');
		if (!field || !clearLink) return;
		function updateClearVisibility() {
			clearLink.classList.toggle('is-visible', (field.value || '').trim().length > 0);
		}
		function updateEmptyState() {
			wrap.classList.toggle('is-empty', !(field.value || '').trim().length);
		}
		field.addEventListener('input', () => {
			updateClearVisibility();
			updateEmptyState();
		});
		field.addEventListener('change', () => {
			updateClearVisibility();
			updateEmptyState();
		});
		updateClearVisibility();
		updateEmptyState();
		clearLink.addEventListener('click', (e) => {
			e.preventDefault();
			field.value = '';
			clearLink.classList.remove('is-visible');
			wrap.classList.add('is-empty');
			field.dispatchEvent(new Event('input', { bubbles: true }));
			try {
				refreshAutoGrowTextareas(document);
			} catch (_) {}
		});
	});

	// Style thumbnails and data-style-value on columns (restored from pre-4d5956d entry-create.js)
	const styleSection = document.querySelector('.create-content .create-style-section');
	const allStyleCards = styleSection?.querySelectorAll('.create-style-card');
	if (allStyleCards?.length && document.body.classList.contains('create-page')) {
		allStyleCards.forEach((card, i) => {
			card.setAttribute('data-color-index', String(i % 9));
		});
		const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
		const qs = v ? `?v=${encodeURIComponent(v)}` : '';
		import(`../create-styles.js${qs}`).then(({ getStyleThumbUrl }) => {
			allStyleCards.forEach((card) => {
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
		});
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
				return (localStorage.getItem(STORAGE_KEYS.styleSelected) || '').trim();
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
		requestAnimationFrame(() => requestAnimationFrame(run));

		// Card click: select the clicked card only (no scroll)
		const section = document.querySelector('.create-content .create-style-section');
		section?.querySelectorAll('.create-style-card[data-key]').forEach((card) => {
			card.addEventListener('click', () => selectCard(card));
		});

		// Save scroll position when user scrolls (do not change which card is selected)
		let styleSaveTimer;
		function scheduleStyleSave() {
			clearTimeout(styleSaveTimer);
			styleSaveTimer = setTimeout(() => {
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
		styleCards.addEventListener('scroll', scheduleStyleSave, { passive: true });
		if ('scrollend' in styleCards) styleCards.addEventListener('scrollend', scheduleStyleSave);
	}

	// Create Image / Edit Image button state and submit (restored from pre-4d5956d entry-create.js)
	const generateButtons = document.querySelectorAll('.create-content .create-btn-generate');
	const createImageBtn = generateButtons[0];
	const editImageBtn = generateButtons[1];

	function getSelectedStyleKey() {
		const section = document.querySelector('.create-content .create-style-section');
		const selected = section?.querySelector('.create-style-card.is-selected');
		if (selected) return selected.getAttribute('data-key') || 'none';
		try {
			const saved = localStorage.getItem(STORAGE_KEYS.styleSelected);
			return (saved || 'none').trim();
		} catch {
			return 'none';
		}
	}

	function updateCreateImageButtonState() {
		if (!createImageBtn) return;
		const hasPrompt = (textToImagePrompt?.value || '').trim().length > 0;
		createImageBtn.disabled = !hasPrompt;
	}
	updateCreateImageButtonState();
	if (textToImagePrompt) {
		textToImagePrompt.addEventListener('input', updateCreateImageButtonState);
		textToImagePrompt.addEventListener('change', updateCreateImageButtonState);
	}

	function extractMentions(prompt) {
		const text = typeof prompt === 'string' ? prompt : '';
		if (!text) return [];
		const out = [];
		const seen = new Set();
		const re = /@([a-zA-Z0-9_]+)/g;
		let match;
		while ((match = re.exec(text)) !== null) {
			const full = `@${match[1]}`;
			if (seen.has(full)) continue;
			seen.add(full);
			out.push(full);
		}
		return out;
	}

	async function validateMentionsSimple(args) {
		const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
		const mentions = extractMentions(prompt);
		if (mentions.length === 0) return { ok: true, mentions };
		const res = await fetch('/api/create/validate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ args: args || {} }),
		});
		const data = await res.json().catch(() => ({}));
		if (res.ok) return { ok: true, mentions, data };
		return { ok: false, mentions, data, status: res.status };
	}

	if (createImageBtn) {
		createImageBtn.addEventListener('click', async () => {
			const userPrompt = (textToImagePrompt?.value || '').trim();
			if (!userPrompt) return;
			const styleKey = getSelectedStyleKey();
			const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
			const qs = v ? `?v=${encodeURIComponent(v)}` : '';
			const { submitCreationWithPending, formatMentionsFailureForDialog } = await import(`../../shared/createSubmit.js${qs}`);
			const doSubmit = (hydrateMentions) => {
				submitCreationWithPending({
					serverId: 1,
					methodKey: 'fluxImage',
					args: { prompt: userPrompt },
					styleKey: styleKey !== 'none' ? styleKey : undefined,
					hydrateMentions,
					navigate: 'full',
				});
			};
			const mentions = extractMentions(userPrompt);
			if (mentions.length === 0) {
				doSubmit(false);
				return;
			}
			const validateResult = await validateMentionsSimple({ args: { prompt: userPrompt } });
			if (validateResult.ok) {
				doSubmit(true);
				return;
			}
			const message = formatMentionsFailureForDialog(validateResult.data);
			if (window.confirm(message + '\n\nSubmit anyway?')) {
				doSubmit(false);
			}
		});
	}

	const mutateOptions = { serverId: null, methodKey: null };
	async function loadMutateOptions() {
		const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
		const qs = v ? `?v=${encodeURIComponent(v)}` : '';
		const { loadFirstMutateOptions } = await import(`../../shared/mutateOptions.js${qs}`);
		const first = await loadFirstMutateOptions();
		if (first) {
			mutateOptions.serverId = first.serverId;
			mutateOptions.methodKey = first.methodKey;
		}
	}

	function updateEditImageButtonState() {
		if (!editImageBtn) return;
		const hasImage = Boolean(imageEditValue);
		const hasPrompt = (imageEditPrompt?.value || '').trim().length > 0;
		const hasMutate = Boolean(mutateOptions.serverId && mutateOptions.methodKey);
		editImageBtn.disabled = !hasImage || !hasPrompt || !hasMutate;
	}
	window.updateEditImageButtonState = updateEditImageButtonState;
	void loadMutateOptions().then(() => updateEditImageButtonState());
	if (imageEditPrompt) {
		imageEditPrompt.addEventListener('input', updateEditImageButtonState);
		imageEditPrompt.addEventListener('change', updateEditImageButtonState);
	}

	if (editImageBtn) {
		editImageBtn.addEventListener('click', async () => {
			const userPrompt = (imageEditPrompt?.value || '').trim();
			if (!userPrompt || !imageEditValue) return;
			if (!mutateOptions.serverId || !mutateOptions.methodKey) return;
			let imageUrl;
			if (imageEditValue instanceof File) {
				try {
					const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
					const qs = v ? `?v=${encodeURIComponent(v)}` : '';
					const { uploadImageFile } = await import(`../../shared/createSubmit.js${qs}`);
					imageUrl = await uploadImageFile(imageEditValue);
				} catch (err) {
					alert(err?.message || 'Image upload failed');
					return;
				}
			} else {
				imageUrl = typeof imageEditValue === 'string' ? imageEditValue : '';
			}
			if (!imageUrl) {
				alert('Please choose an image.');
				return;
			}
			const args = { prompt: userPrompt, image_url: imageUrl };
			const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
			const qs = v ? `?v=${encodeURIComponent(v)}` : '';
			const { submitCreationWithPending, formatMentionsFailureForDialog } = await import(`../../shared/createSubmit.js${qs}`);
			const doSubmit = (hydrateMentions) => {
				submitCreationWithPending({
					serverId: mutateOptions.serverId,
					methodKey: mutateOptions.methodKey,
					args,
					hydrateMentions,
					navigate: 'full',
				});
			};
			const mentions = extractMentions(userPrompt);
			if (mentions.length === 0) {
				doSubmit(false);
				return;
			}
			const validateResult = await validateMentionsSimple({ args });
			if (validateResult.ok) {
				doSubmit(true);
				return;
			}
			const message = formatMentionsFailureForDialog(validateResult.data);
			if (window.confirm(message + '\n\nSubmit anyway?')) {
				doSubmit(false);
			}
		});
	}
}

