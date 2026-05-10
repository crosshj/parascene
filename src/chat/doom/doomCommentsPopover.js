/**
 * Doom scroll: comments bottom sheet — WIP; links out to creation detail for comments.
 */

/** @type {HTMLElement | null} */
let overlayEl = null;

/** @type {((ev: KeyboardEvent) => void) | null} */
let escapeHandler = null;

let priorBodyOverflow = '';

/**
 * @param {HTMLElement} root
 */
function bindOverlayDismiss(root) {
	const backdrop = root.querySelector('[data-chat-doom-comments-dismiss]');
	const closeBtn = root.querySelector('[data-chat-doom-comments-close]');
	const detailLink = root.querySelector('[data-chat-doom-comments-detail]');
	if (backdrop instanceof HTMLElement) {
		backdrop.addEventListener('click', () => closeDoomCommentsPopover());
	}
	if (closeBtn instanceof HTMLElement) {
		closeBtn.addEventListener('click', () => closeDoomCommentsPopover());
	}
	if (detailLink instanceof HTMLElement) {
		detailLink.addEventListener('click', (ev) => {
			if (detailLink.getAttribute('aria-disabled') === 'true') {
				ev.preventDefault();
				return;
			}
			closeDoomCommentsPopover();
		});
	}
}

function ensureOverlay() {
	if (overlayEl instanceof HTMLElement && overlayEl.isConnected) return overlayEl;

	const wrap = document.createElement('div');
	wrap.className = 'chat-doom-comments-overlay';
	wrap.hidden = true;
	wrap.setAttribute('aria-hidden', 'true');
	wrap.innerHTML = `
		<div class="chat-doom-comments-backdrop" data-chat-doom-comments-dismiss tabindex="-1" aria-hidden="true"></div>
		<div class="chat-doom-comments-sheet" role="dialog" aria-modal="true" aria-labelledby="chat-doom-comments-title">
			<div class="chat-doom-comments-handle" aria-hidden="true"></div>
			<div class="chat-doom-comments-head">
				<div class="chat-doom-comments-head-title-block">
					<h2 id="chat-doom-comments-title" class="chat-doom-comments-title">Comments</h2>
					<span class="chat-doom-comments-count-wrap" data-chat-doom-comments-count-wrap>
						<span class="chat-doom-comments-count chat-doom-comments-count--skeleton" data-chat-doom-comments-count aria-hidden="true"></span>
					</span>
				</div>
				<button type="button" class="chat-doom-comments-close" data-chat-doom-comments-close aria-label="Close comments">
					<svg class="chat-doom-comments-close-icon" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
						<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"></path>
					</svg>
				</button>
			</div>
			<div class="chat-doom-comments-body">
				<p class="chat-doom-comments-wip-note">
					Comments in chat are still a work in progress. On the creation page you can read and add comments.
				</p>
				<a class="btn-outlined chat-doom-comments-detail-btn" href="#" data-chat-doom-comments-detail>Open creation</a>
			</div>
		</div>
	`;

	document.body.appendChild(wrap);
	overlayEl = wrap;
	bindOverlayDismiss(wrap);
	return wrap;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.commentCountLabel] — digits from rail badge (display only)
 * @param {string} [opts.detailHref] — creation detail URL (e.g. /creations/&lt;id&gt;#comments)
 */
export function openDoomCommentsPopover(opts = {}) {
	const root = ensureOverlay();
	const label = typeof opts.commentCountLabel === 'string' ? opts.commentCountLabel.trim() : '';
	const detailHrefRaw = typeof opts.detailHref === 'string' ? opts.detailHref.trim() : '';
	const countEl = root.querySelector('[data-chat-doom-comments-count]');
	const wrapEl = root.querySelector('[data-chat-doom-comments-count-wrap]');
	const detailEl = root.querySelector('[data-chat-doom-comments-detail]');

	if (countEl instanceof HTMLElement) {
		if (label) {
			countEl.textContent = label;
			countEl.classList.remove('chat-doom-comments-count--skeleton');
			countEl.removeAttribute('aria-hidden');
		} else {
			countEl.textContent = '';
			countEl.classList.add('chat-doom-comments-count--skeleton');
			countEl.setAttribute('aria-hidden', 'true');
		}
	}
	if (wrapEl instanceof HTMLElement) {
		wrapEl.hidden = false;
	}
	if (detailEl instanceof HTMLAnchorElement) {
		if (detailHrefRaw) {
			detailEl.href = detailHrefRaw;
			detailEl.removeAttribute('aria-disabled');
		} else {
			detailEl.href = '#';
			detailEl.setAttribute('aria-disabled', 'true');
		}
	}

	root.hidden = false;
	root.setAttribute('aria-hidden', 'false');

	priorBodyOverflow = document.body.style.overflow;
	document.body.style.overflow = 'hidden';

	if (escapeHandler) {
		window.removeEventListener('keydown', escapeHandler);
	}
	escapeHandler = (ev) => {
		if (ev.key === 'Escape') {
			ev.preventDefault();
			closeDoomCommentsPopover();
		}
	};
	window.addEventListener('keydown', escapeHandler);

	const closeBtn = root.querySelector('[data-chat-doom-comments-close]');
	if (closeBtn instanceof HTMLElement) closeBtn.focus();
}

export function closeDoomCommentsPopover() {
	if (!(overlayEl instanceof HTMLElement)) return;
	overlayEl.hidden = true;
	overlayEl.setAttribute('aria-hidden', 'true');
	document.body.style.overflow = priorBodyOverflow;
	if (escapeHandler) {
		window.removeEventListener('keydown', escapeHandler);
		escapeHandler = null;
	}
}

/** Remove from DOM (e.g. doom scroll teardown). */
export function destroyDoomCommentsPopover() {
	closeDoomCommentsPopover();
	try {
		overlayEl?.remove();
	} catch {
		// ignore
	}
	overlayEl = null;
}
