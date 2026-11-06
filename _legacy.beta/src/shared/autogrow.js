/**
 * Autogrow textareas (Rollup bundle copy; keep in sync with `public/shared/autogrow.js`).
 * Diff: static `viewport` import so the bundle has no extra dynamic fetch.
 */
import { getPromptEditorMaxHeightPx } from './viewport.js';

const DEFAULT_MAX_HEIGHT_PX = 1200;

const minHeightCache = new WeakMap();
const rafTokenCache = new WeakMap();
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
	return el.getClientRects().length > 0;
}

function getEmptyScrollHeight(textarea) {
	const cached = minHeightCache.get(textarea);
	if (Number.isFinite(cached) && cached > 0) return cached;

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
		textarea.style.height = 'auto';

		const emptyHeight = getEmptyScrollHeight(textarea);
		const next = textarea.scrollHeight;
		const clamped = Math.min(maxHeightPx, Math.max(emptyHeight || 0, next || 0));
		if (clamped > 0) {
			textarea.style.height = `${clamped}px`;
		}
	} finally {
		programmaticResizeTextareas.delete(textarea);
	}
}

export function attachAutoGrowTextarea(textarea, { maxHeightPx = DEFAULT_MAX_HEIGHT_PX } = {}) {
	if (!(textarea instanceof HTMLTextAreaElement)) return () => {};

	textarea.dataset.autogrow = textarea.dataset.autogrow || 'true';
	const isPromptEditor = textarea.classList.contains('prompt-editor');
	if (isPromptEditor) {
		textarea.style.overflowY = 'auto';
		textarea.style.resize = 'none';
	} else {
		textarea.style.overflow = 'hidden';
		textarea.style.resize = 'none';
	}

	const getMaxPx = () => (isPromptEditor ? getPromptEditorMaxHeightPx() : maxHeightPx);
	const refresh = () => schedule(textarea, () => resizeAutoGrowTextarea(textarea, { maxHeightPx: getMaxPx() }));

	textarea.addEventListener('input', refresh);
	textarea.addEventListener('change', refresh);
	textarea.addEventListener('focus', refresh);

	refresh();
	setTimeout(refresh, 0);
	setTimeout(refresh, 60);
	setTimeout(refresh, 250);

	if (typeof ResizeObserver !== 'undefined') {
		const ro = new ResizeObserver(() => {
			if (programmaticResizeTextareas.has(textarea)) return;
			minHeightCache.delete(textarea);
			refresh();
		});
		ro.observe(textarea);
		textarea.addEventListener('blur', () => {});
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
	const textareas = Array.from(
		scope.querySelectorAll('textarea[data-autogrow], textarea[data-autogrow="true"], textarea[data-feature-request-message]')
	);
	textareas.forEach((ta) => {
		attachAutoGrowTextarea(ta);
	});
}
