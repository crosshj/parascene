/**
 * Viewport / device helpers (bundle copy; keep in sync with `public/shared/viewport.js`).
 */

export function isIOS() {
	return /iPad|iPhone|iPod/.test(navigator.userAgent || '');
}

export function getPromptEditorMaxHeightPx() {
	if (typeof window === 'undefined' || !window.innerHeight) return 400;
	return Math.round(0.38 * window.innerHeight);
}
