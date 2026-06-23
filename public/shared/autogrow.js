const _qs = (() => {
	const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
	return v ? `?v=${encodeURIComponent(v)}` : '';
})();
const { getPromptEditorMaxHeightPx } = await import(`./viewport.js${_qs}`);

const DEFAULT_MAX_HEIGHT_PX = 1200;

// Track per-element minimum heights computed from "empty" content.
const minHeightCache = new WeakMap();
const minHeightWidthCache = new WeakMap();
const rafTokenCache = new WeakMap();
const autogrowRefreshByTextarea = new WeakMap();
const programmaticResizeTextareas = new WeakSet();

function preserveTextareaCaret(textarea, mutate) {
	const hadFocus = document.activeElement === textarea;
	const selStart = textarea.selectionStart;
	const selEnd = textarea.selectionEnd;
	const scrollTop = textarea.scrollTop;
	mutate();
	if (!hadFocus) return;
	const len = textarea.value.length;
	try {
		textarea.setSelectionRange(Math.min(selStart, len), Math.min(selEnd, len));
	} catch (_) {}
	textarea.scrollTop = scrollTop;
}

function isVisible(el) {
	if (!(el instanceof HTMLElement)) return false;
	// getClientRects is empty when display:none or not in DOM flow.
	return el.getClientRects().length > 0;
}

function getEmptyScrollHeight(textarea) {
	const width = textarea.clientWidth;
	const cachedWidth = minHeightWidthCache.get(textarea);
	const cached = minHeightCache.get(textarea);
	if (
		cachedWidth === width &&
		Number.isFinite(cached) &&
		cached > 0
	) {
		return cached;
	}

	const previousValue = textarea.value;
	const previousHeight = textarea.style.height;
	let h = 0;

	preserveTextareaCaret(textarea, () => {
		textarea.value = '';
		textarea.style.height = 'auto';
		h = textarea.scrollHeight;
		textarea.value = previousValue;
		textarea.style.height = previousHeight;
	});

	if (Number.isFinite(h) && h > 0) {
		minHeightCache.set(textarea, h);
		minHeightWidthCache.set(textarea, width);
		return h;
	}
	return 0;
}

function schedule(el, fn) {
	const existing = rafTokenCache.get(el);
	if (existing) cancelAnimationFrame(existing);
	const token = requestAnimationFrame(() => {
		rafTokenCache.delete(el);
		fn();
	});
	rafTokenCache.set(el, token);
}

export function resizeAutoGrowTextarea(textarea, { maxHeightPx = DEFAULT_MAX_HEIGHT_PX } = {}) {
	if (!(textarea instanceof HTMLTextAreaElement)) return;
	if (!isVisible(textarea)) return;

	programmaticResizeTextareas.add(textarea);
	try {
		const isPromptEditor = textarea.classList.contains('prompt-editor');
		// overflow-y:auto + fixed height makes scrollHeight stick at clientHeight when typing
		// at end-of-string (wrapped lines scroll internally). Measure with overflow hidden
		// and height collapsed so scrollHeight reflects full content.
		if (isPromptEditor) {
			textarea.style.overflowY = 'hidden';
		}
		textarea.style.height = '0px';

		const emptyHeight = getEmptyScrollHeight(textarea);
		const next = textarea.scrollHeight;
		const clamped = Math.min(maxHeightPx, Math.max(emptyHeight || 0, next || 0));
		if (clamped > 0) {
			textarea.style.height = `${clamped}px`;
		}
		if (isPromptEditor) {
			const atMax = next > maxHeightPx;
			textarea.style.overflowY = atMax ? 'auto' : 'hidden';
			if (atMax && textarea.selectionStart === textarea.value.length) {
				textarea.scrollTop = textarea.scrollHeight;
			}
		}
	} finally {
		programmaticResizeTextareas.delete(textarea);
	}
}

export function attachAutoGrowTextarea(textarea, { maxHeightPx = DEFAULT_MAX_HEIGHT_PX } = {}) {
	if (!(textarea instanceof HTMLTextAreaElement)) return () => {};

	const existingRefresh = autogrowRefreshByTextarea.get(textarea);
	if (typeof existingRefresh === 'function') {
		return existingRefresh;
	}

	textarea.dataset.autogrow = textarea.dataset.autogrow || 'true';
	const isPromptEditor = textarea.classList.contains('prompt-editor');
	// Prompt editors: cap height and scroll internally at max (see resizeAutoGrowTextarea).
	if (isPromptEditor) {
		textarea.style.overflowY = 'hidden';
		textarea.style.resize = 'none';
	} else {
		textarea.style.overflow = 'hidden';
		textarea.style.resize = 'none';
	}

	const getMaxPx = () => (isPromptEditor ? getPromptEditorMaxHeightPx() : maxHeightPx);
	const refresh = () =>
		schedule(textarea, () => resizeAutoGrowTextarea(textarea, { maxHeightPx: getMaxPx() }));

	autogrowRefreshByTextarea.set(textarea, refresh);

	textarea.addEventListener('input', refresh);
	textarea.addEventListener('change', refresh);
	textarea.addEventListener('focus', refresh);

	// Initial sizing: do a few passes to handle late font/layout settling.
	refresh();
	setTimeout(refresh, 0);
	setTimeout(refresh, 60);
	setTimeout(refresh, 250);

	// ResizeObserver handles width changes (layout / orientation).
	if (typeof ResizeObserver !== 'undefined') {
		const ro = new ResizeObserver(() => {
			if (programmaticResizeTextareas.has(textarea)) return;
			minHeightCache.delete(textarea);
			minHeightWidthCache.delete(textarea);
			refresh();
		});
		ro.observe(textarea);
		textarea.addEventListener('blur', () => {
			// keep observer; no-op
		});
	}

	return refresh;
}

/**
 * Match chat composer: on mobile (coarse/no fine pointer), Enter inserts a newline;
 * on desktop, Enter submits and Shift+Enter inserts a newline.
 */
export function composerEnterKeySubmits() {
	try {
		return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
	} catch {
		return typeof window.innerWidth === 'number' && window.innerWidth >= 768;
	}
}

export function refreshAutoGrowTextareas(root = document) {
	const scope = root instanceof Document ? root : root instanceof HTMLElement ? root : document;
	const textareas = Array.from(scope.querySelectorAll('textarea[data-autogrow], textarea[data-autogrow="true"], textarea[data-feature-request-message]'));
	textareas.forEach((ta) => {
		attachAutoGrowTextarea(ta);
	});
}

