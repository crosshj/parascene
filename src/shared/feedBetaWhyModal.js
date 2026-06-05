/**
 * Feed [beta] "Why am I seeing this?" modal — displays server-stamped `feed_beta_why` only.
 */

let activeOverlay = null;

/**
 * @param {object|null|undefined} why — `feed_beta_why` from API
 */
export function openFeedBetaWhyModal(why) {
	if (!why || typeof why !== 'object') return;
	closeFeedBetaWhyModal();

	const overlay = document.createElement('div');
	overlay.className = 'modal-overlay feed-beta-why-overlay open';
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-labelledby', 'feed-beta-why-title');

	const developer =
		why.developer && typeof why.developer === 'object' ? why.developer : null;
	const label =
		typeof why.label === 'string' && why.label.trim() ? why.label.trim() : '';
	const summary =
		typeof why.summary === 'string' && why.summary.trim() ? why.summary.trim() : 'Shown in Feed [beta].';
	const details = Array.isArray(why.details)
		? why.details.filter((d) => typeof d === 'string' && d.trim())
		: [];

	const labelHtml = label
		? `<p class="feed-beta-why-label">${escapeHtml(label)}</p>`
		: '';

	const detailsHtml =
		details.length > 0
			? `<ul class="feed-beta-why-details">${details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`
			: '';

	const devHtml = developer
		? `<details class="feed-beta-why-dev"><summary>Developer details</summary><pre class="feed-beta-why-dev-pre">${escapeHtml(JSON.stringify(developer, null, 2))}</pre></details>`
		: '';

	overlay.innerHTML = `
		<div class="modal feed-beta-why-modal">
			<div class="feed-beta-why-header">
				<h2 id="feed-beta-why-title" class="feed-beta-why-title">Why am I seeing this?</h2>
				<button type="button" class="feed-beta-why-close" aria-label="Close">&times;</button>
			</div>
			<div class="feed-beta-why-body">
				${labelHtml}
				<p class="feed-beta-why-summary">${escapeHtml(summary)}</p>
				${detailsHtml}
				${devHtml}
			</div>
		</div>
	`;

	const closeBtn = overlay.querySelector('.feed-beta-why-close');
	closeBtn?.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		closeFeedBetaWhyModal();
	});
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) closeFeedBetaWhyModal();
	});

	document.body.appendChild(overlay);
	activeOverlay = overlay;
	document.body.classList.add('modal-open');

	const onKey = (e) => {
		if (e.key === 'Escape') {
			closeFeedBetaWhyModal();
		}
	};
	overlay._feedBetaWhyKeyHandler = onKey;
	document.addEventListener('keydown', onKey);
}

export function closeFeedBetaWhyModal() {
	if (!activeOverlay) return;
	const handler = activeOverlay._feedBetaWhyKeyHandler;
	if (handler) document.removeEventListener('keydown', handler);
	activeOverlay.remove();
	activeOverlay = null;
	document.body.classList.remove('modal-open');
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
