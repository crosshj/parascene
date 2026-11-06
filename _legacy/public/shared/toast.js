/**
 * Show a short-lived toast message at center-bottom of the viewport.
 * @param {string} message - Text to show
 * @param {{ durationMs?: number }} [opts] - durationMs defaults to 2000
 */
export function showToast(message, opts = {}) {
	const durationMs = Number.isFinite(opts.durationMs) ? opts.durationMs : 2000;

	let container = document.querySelector('.app-toast-container');
	if (!container) {
		container = document.createElement('div');
		container.className = 'app-toast-container';
		container.setAttribute('aria-live', 'polite');
		container.setAttribute('aria-atomic', 'true');
		document.body.appendChild(container);
	}

	const el = document.createElement('div');
	el.className = 'app-toast';
	el.textContent = message;
	container.appendChild(el);

	// Trigger reflow so transition runs
	el.offsetHeight;
	el.classList.add('app-toast-visible');

	const t = setTimeout(() => {
		el.classList.remove('app-toast-visible');
		setTimeout(() => {
			el.remove();
		}, 200);
	}, durationMs);

	return () => clearTimeout(t);
}
