import './feedWhyModal.css';
import { createModalDismissButton } from './modalDismiss.js';

/**
 * Ranked-feed "Why am I seeing this?" modal — displays server-stamped `feed_why` only.
 */

let activeOverlay = null;

/**
 * @param {object|null|undefined} why — `feed_why` from API
 */
export function openFeedWhyModal(why, { signal } = {}) {
	if (!why || typeof why !== 'object' || signal?.aborted) return;
	closeFeedWhyModal();

	const overlay = document.createElement('dialog');
	overlay.className = 'app-dialog feed-why-modal';
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-labelledby', 'feed-why-title');

	const developer =
		why.developer && typeof why.developer === 'object' ? why.developer : null;
	const label =
		typeof why.label === 'string' && why.label.trim() ? why.label.trim() : '';
	const summary =
		typeof why.summary === 'string' && why.summary.trim() ? why.summary.trim() : 'Shown in Feed.';
	const details = Array.isArray(why.details)
		? why.details.filter((d) => typeof d === 'string' && d.trim())
		: [];

	const labelHtml = label
		? `<p class="feed-why-label">${escapeHtml(label)}</p>`
		: '';

	const detailsHtml =
		details.length > 0
			? `<ul class="feed-why-details">${details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`
			: '';

	const devHtml = developer
		? `<details class="feed-why-dev"><summary>Developer details</summary><pre class="feed-why-dev-pre">${escapeHtml(JSON.stringify(developer, null, 2))}</pre></details>`
		: '';

	overlay.innerHTML = `
		<header class="app-dialog__header">
				<h2 id="feed-why-title" class="app-dialog__title">Why am I seeing this?</h2>
			</header>
			<div class="app-dialog__body">
				${labelHtml}
				<p class="feed-why-summary">${escapeHtml(summary)}</p>
				${detailsHtml}
				${devHtml}
			</div>
	`;

	const closeBtn = createModalDismissButton();
	overlay.querySelector('header').append(closeBtn);
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		signal?.removeEventListener('abort', dispose);
		if (overlay.open) overlay.close();
		overlay.remove();
		if (activeOverlay === overlay) activeOverlay = null;
	};
	overlay._dispose = dispose;
	closeBtn.addEventListener('click', dispose);
	overlay.addEventListener('click', event => { if (event.target === overlay) dispose(); });
	overlay.addEventListener('close', dispose, { once: true });
	signal?.addEventListener('abort', dispose, { once: true });
	document.body.append(overlay);
	activeOverlay = overlay;
	overlay.showModal();
}

export function closeFeedWhyModal() {
	activeOverlay?._dispose();
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
