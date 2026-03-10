/**
 * Create page: nav, nav-mobile, modals, tabs (create.html), route-create (createAdvanced.html).
 * Also runs create-page-specific wiring (image picker, localStorage, style cards, submit buttons).
 * Imports are dynamic with cache-busting (version) so components are not served from cache.
 */

// Only wait for above-the-fold / interactive shell; modals hydrate in background
const TAGS = [
	'app-navigation',
	'app-navigation-mobile',
	'app-tabs',
	'app-route-create',
];

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
	await waitForComponents(TAGS);
	runCreatePageInit(refreshAutoGrowTextareas);
}

function runCreatePageInit(refreshAutoGrowTextareas) {
	if (!document.body.classList.contains('create-page') && !document.body.classList.contains('create-page-advanced')) return;

	const changeLink = document.getElementById('create-change-image-link');
	const area = document.querySelector('.create-image-edit-area');
	/** @type {string|File|null} */
	let imageEditValue = null;

	function openImagePicker() {
		import('../../shared/providerFormFields.js').then(({ openImagePickerModal }) => {
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

	let selectedColumnIndex = -1;

	function updateSelectedColumn(index) {
		selectedColumnIndex = index;
		styleColumns.forEach((col, i) => {
			col.classList.toggle('is-selected', i === index);
		});
		saveStyleIndex(index);
	}

	if (tabsEl) {
		const savedTabId = (() => {
			try {
				return localStorage.getItem(STORAGE_KEYS.tab) || '';
			} catch {
				return '';
			}
		})();
		if (savedTabId) {
			tabsEl.setAttribute('data-active-id', savedTabId);
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
		[textToImagePrompt, imageEditPrompt].forEach((input) => {
			if (!input) return;
			input.addEventListener('input', () => {
				savePrompts();
				refreshAutoGrowTextareas();
			});
		});
	}

	if (styleColumns.length > 0) {
		const savedIndex = (() => {
			try {
				const raw = localStorage.getItem(STORAGE_KEYS.styleIndex);
				const n = raw != null ? Number(raw) : NaN;
				return Number.isFinite(n) ? n : -1;
			} catch {
				return -1;
			}
		})();
		if (savedIndex >= 0 && savedIndex < styleColumns.length) {
			updateSelectedColumn(savedIndex);
		}
		styleColumns.forEach((col, index) => {
			col.addEventListener('click', () => {
				updateSelectedColumn(index);
				const val = col.dataset?.styleValue;
				if (val != null) saveStyleSelected(val);
			});
		});
	}
}

