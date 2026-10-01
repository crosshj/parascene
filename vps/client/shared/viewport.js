/**
 * VPS viewport and device helpers.
 */

export function isIOS() {
	return /iPad|iPhone|iPod/.test(navigator.userAgent || '');
}

export function getPromptEditorMaxHeightPx() {
	if (typeof window === 'undefined' || !window.innerHeight) return 400;
	return Math.round(0.38 * window.innerHeight);
}
