/**
 * Modal navigation helper (bundle copy; keep in sync with `public/shared/navigation.js`).
 */

export function closeModalsAndNavigate(href) {
	if (!href || typeof href !== 'string') return;
	const trimmed = href.trim();
	if (!trimmed || trimmed === '#') return;

	document.dispatchEvent(new CustomEvent('close-all-modals'));
	window.location.href = trimmed;
}
