/**
 * Doom scroll: comments bottom sheet — WIP; links out to creation detail for comments.
 * History + rail click are consumed in `chatPage.js` (document/window capture) so this module
 * only owns DOM, `#comments` push/replaceState, and teardown.
 */

const SHEET_HASH = '#comments';

/** @type {HTMLElement | null} */
let overlayEl = null;
/** @type {((ev: KeyboardEvent) => void) | null} */
let escapeHandler = null;
let priorBodyOverflow = '';
let didSetBodyOverflow = false;

/**
 * Called from `chatPage` capture listeners. If the sheet is open and the URL no longer has
 * `#comments`, close the sheet and return true so the caller can `stopImmediatePropagation`.
 * @returns {boolean}
 */
export function tryConsumeDoomCommentsHistoryForCapture() {
	if (!(overlayEl instanceof HTMLElement) || overlayEl.hidden) return false;
	if (document.documentElement?.dataset?.chatDoomCommentsOpen !== '1') return false;
	if (window.location.hash === SHEET_HASH) return false;
	closeDoomCommentsPopover({ fromHistory: true });
	return true;
}

function stripSheetHashFromUrl() {
	if (window.location.hash !== SHEET_HASH) return;
	const u = new URL(window.location.href);
	u.hash = '';
	window.history.replaceState(window.history.state || {}, '', `${u.pathname}${u.search || ''}`);
}

function bindDismiss(root) {
	const stop = (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		closeDoomCommentsPopover();
	};
	root.querySelector('[data-chat-doom-comments-dismiss]')?.addEventListener('click', stop);
	root.querySelector('[data-chat-doom-comments-close]')?.addEventListener('click', stop);
	const detail = root.querySelector('[data-chat-doom-comments-detail]');
	if (detail instanceof HTMLElement) {
		detail.addEventListener('click', (ev) => {
			if (detail.getAttribute('aria-disabled') === 'true') {
				ev.preventDefault();
				ev.stopPropagation();
				return;
			}
			closeDoomCommentsPopover();
		});
	}
}

function ensureOverlay() {
	if (overlayEl?.isConnected) return overlayEl;

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
	bindDismiss(wrap);
	return wrap;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.commentCountLabel]
 * @param {string} [opts.detailHref]
 */
export function openDoomCommentsPopover(opts = {}) {
	const root = ensureOverlay();
	const label = String(opts.commentCountLabel ?? '').trim();
	const detailHref = String(opts.detailHref ?? '').trim();

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
	if (wrapEl instanceof HTMLElement) wrapEl.hidden = false;

	if (detailEl instanceof HTMLAnchorElement) {
		if (detailHref) {
			detailEl.href = detailHref;
			detailEl.removeAttribute('aria-disabled');
		} else {
			detailEl.href = '#';
			detailEl.setAttribute('aria-disabled', 'true');
		}
	}

	document.documentElement.dataset.chatDoomCommentsOpen = '1';

	if (window.location.hash !== SHEET_HASH) {
		const st = typeof history.state === 'object' && history.state !== null ? history.state : {};
		window.history.pushState(
			{ ...st, doomCommentsSheet: 1 },
			'',
			`${window.location.pathname}${window.location.search || ''}${SHEET_HASH}`
		);
	}

	root.hidden = false;
	root.setAttribute('aria-hidden', 'false');

	didSetBodyOverflow = false;
	if (!document.body.classList.contains('chat-page--doom-scroll')) {
		priorBodyOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		didSetBodyOverflow = true;
	}

	if (escapeHandler) window.removeEventListener('keydown', escapeHandler);
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

export function closeDoomCommentsPopover(opts = {}) {
	if (!(overlayEl instanceof HTMLElement)) return;

	overlayEl.hidden = true;
	overlayEl.setAttribute('aria-hidden', 'true');

	if (didSetBodyOverflow) document.body.style.overflow = priorBodyOverflow;
	didSetBodyOverflow = false;

	if (escapeHandler) {
		window.removeEventListener('keydown', escapeHandler);
		escapeHandler = null;
	}
	delete document.documentElement.dataset.chatDoomCommentsOpen;

	if (!opts.fromHistory && window.location.hash === SHEET_HASH) stripSheetHashFromUrl();
}

export function destroyDoomCommentsPopover() {
	closeDoomCommentsPopover();
	try {
		overlayEl?.remove();
	} catch {
		// ignore
	}
	overlayEl = null;
}
