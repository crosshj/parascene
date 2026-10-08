/**
 * Doom scroll comments bottom sheet.
 *
 * Same sheet as www: a fixed overlay (not a native dialog), `#comments` history,
 * and a viewport hint so the soft keyboard draws over the lower part of the sheet
 * instead of resizing the page. The thread scrolls inside `[data-chat-doom-comments-body]`.
 */

import { mountCreationCommentsThread } from '../../shared/creationCommentsThread.js';
import './DoomCommentsPopover.css';

const SHEET_HASH = '#comments';

/**
 * While the comments sheet is open, swap `<meta name="viewport" interactive-widget>` to
 * `overlays-content` where supported (e.g. Chrome Android) so the soft keyboard can draw on top
 * of the page instead of shrinking the layout viewport — closer to YouTube Shorts. Restored on
 * close. Other engines may ignore the hint and keep resizing the layout.
 */
let savedViewportContentForCommentsSheet = null;

function applyOverlaysViewportForCommentsSheet() {
	if (savedViewportContentForCommentsSheet != null) return;
	const meta = document.querySelector('meta[name="viewport"]');
	if (!(meta instanceof HTMLMetaElement) || typeof meta.content !== 'string') return;
	savedViewportContentForCommentsSheet = meta.content;
	let next = savedViewportContentForCommentsSheet.replace(
		/\binteractive-widget\s*=\s*[\w-]+/gi,
		'interactive-widget=overlays-content'
	);
	if (!/\binteractive-widget\s*=/i.test(next)) {
		const t = savedViewportContentForCommentsSheet.trim();
		next = t ? `${t.replace(/,\s*$/, '')}, interactive-widget=overlays-content` : 'interactive-widget=overlays-content';
	}
	meta.setAttribute('content', next);
}

function restoreViewportAfterCommentsSheet() {
	if (savedViewportContentForCommentsSheet == null) return;
	const meta = document.querySelector('meta[name="viewport"]');
	if (meta instanceof HTMLMetaElement) {
		meta.setAttribute('content', savedViewportContentForCommentsSheet);
	}
	savedViewportContentForCommentsSheet = null;
}

/** @type {HTMLElement | null} */
let overlayEl = null;
/** @type {((ev: KeyboardEvent) => void) | null} */
let escapeHandler = null;
let priorBodyOverflow = '';
let didSetBodyOverflow = false;
/** @type {null | (() => void)} */
let activeThreadTeardown = null;
/** @type {null | Promise<any>} */
let pendingMount = null;
/** @type {null | Promise<any>} */
let viewerProfilePromise = null;

/**
 * If the sheet is open and the URL no longer has `#comments`, close it.
 * Popstate is left to bubble so the SPA router can still change routes.
 * @returns {boolean}
 */
export function tryConsumeDoomCommentsHistoryForCapture() {
	if (!(overlayEl instanceof HTMLElement) || overlayEl.hidden) return false;
	if (document.documentElement?.dataset?.chatDoomCommentsOpen !== '1') return false;
	if (window.location.hash === SHEET_HASH) return false;
	closeDoomCommentsPopover({ fromHistory: true });
	return true;
}

function onDoomCommentsHistory(ev) {
	if (!tryConsumeDoomCommentsHistoryForCapture()) return;
	if (ev.type !== 'popstate') ev.stopImmediatePropagation();
}

window.addEventListener('popstate', onDoomCommentsHistory, true);
window.addEventListener('hashchange', onDoomCommentsHistory, true);

function stripSheetHashFromUrl() {
	if (window.location.hash !== SHEET_HASH) return;
	const u = new URL(window.location.href);
	u.hash = '';
	const st = typeof window.history.state === 'object' && window.history.state !== null ? window.history.state : {};
	window.history.replaceState(st, '', `${u.pathname}${u.search || ''}`);
}

function bindDismiss(root) {
	const stop = (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		closeDoomCommentsPopover();
	};
	root.querySelector('[data-chat-doom-comments-dismiss]')?.addEventListener('click', stop);
	root.querySelector('[data-chat-doom-comments-close]')?.addEventListener('click', stop);
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
			<div class="chat-doom-comments-body" data-chat-doom-comments-body>
				<div data-chat-doom-comments-mount></div>
			</div>
		</div>
	`;

	document.body.appendChild(wrap);
	overlayEl = wrap;
	bindDismiss(wrap);
	return wrap;
}

function setCommentCountLabel(root, label) {
	const countEl = root.querySelector('[data-chat-doom-comments-count]');
	const wrapEl = root.querySelector('[data-chat-doom-comments-count-wrap]');
	if (!(countEl instanceof HTMLElement)) return;
	const trimmed = String(label ?? '').trim();
	if (trimmed) {
		countEl.textContent = trimmed;
		countEl.classList.remove('chat-doom-comments-count--skeleton');
		countEl.removeAttribute('aria-hidden');
	} else {
		countEl.textContent = '';
		countEl.classList.add('chat-doom-comments-count--skeleton');
		countEl.setAttribute('aria-hidden', 'true');
	}
	if (wrapEl instanceof HTMLElement) wrapEl.hidden = false;
}

/** Header already says "Comments"; show just the count number next to it. */
function formatCommentCount(n) {
	const v = Number(n);
	if (!Number.isFinite(v) || v < 0) return '';
	return String(v);
}

/** Best-effort parse of `createdImageId` from a creation URL like `/creations/123` or `/creations/123#comments`. */
function parseCreatedImageIdFromHref(href) {
	if (typeof href !== 'string' || !href) return null;
	const m = href.match(/\/creations\/([0-9]+)/);
	if (!m) return null;
	const id = Number(m[1]);
	return Number.isFinite(id) && id > 0 ? id : null;
}

async function loadViewerProfile() {
	if (viewerProfilePromise) return viewerProfilePromise;
	viewerProfilePromise = (async () => {
		try {
			const r = await fetch('/api/profile', { credentials: 'include', headers: { Accept: 'application/json' } });
			if (!r.ok) return null;
			const j = await r.json().catch(() => null);
			return j && typeof j === 'object' ? j : null;
		} catch {
			return null;
		}
	})();
	return viewerProfilePromise;
}

/** Session user and `/api/profile` both nest `user_name` / `display_name` / `avatar_url` under `profile`. */
function viewerFromProfilePayload(payload) {
	if (!payload || typeof payload !== 'object') {
		return { id: null, userName: '', displayName: '', avatarUrl: '', plan: null };
	}
	const profile = (payload.profile && typeof payload.profile === 'object') ? payload.profile : {};
	const id = Number.isFinite(Number(payload.id)) ? Number(payload.id) : null;
	return {
		id,
		userName: typeof profile.user_name === 'string' ? profile.user_name.trim() : '',
		displayName: typeof profile.display_name === 'string' ? profile.display_name.trim() : '',
		avatarUrl: typeof profile.avatar_url === 'string' ? profile.avatar_url.trim() : '',
		plan: payload.plan === 'founder' ? 'founder' : null,
	};
}

function normalizeViewer(hint, profilePayload) {
	if (hint && typeof hint === 'object' && (typeof hint.userName === 'string' || typeof hint.displayName === 'string')) {
		return {
			id: Number.isFinite(Number(hint.id)) ? Number(hint.id) : null,
			userName: typeof hint.userName === 'string' ? hint.userName.trim() : '',
			displayName: typeof hint.displayName === 'string' ? hint.displayName.trim() : '',
			avatarUrl: typeof hint.avatarUrl === 'string' ? hint.avatarUrl.trim() : '',
			plan: hint.plan === 'founder' ? 'founder' : null,
		};
	}
	const source = hint && typeof hint === 'object' ? hint : profilePayload;
	return viewerFromProfilePayload(source);
}

function teardownActiveThread() {
	if (typeof activeThreadTeardown === 'function') {
		try {
			activeThreadTeardown();
		} catch {
			/* ignore */
		}
		activeThreadTeardown = null;
	}
}

/**
 * @param {object} [opts]
 * @param {string} [opts.commentCountLabel] Initial count label (e.g. from the rail before activity load).
 * @param {string} [opts.detailHref] e.g. `/creations/123#comments` — used to parse createdImageId if not provided.
 * @param {number} [opts.createdImageId] Explicit override; preferred over parsing.
 * @param {object} [opts.viewer] Session user or a normalized viewer. Omitted viewers load `/api/profile`.
 * @param {boolean} [opts.isAdmin]
 */
export function openDoomCommentsPopover(opts = {}) {
	const root = ensureOverlay();
	const label = String(opts.commentCountLabel ?? '').trim();
	const detailHref = String(opts.detailHref ?? '').trim();
	const createdImageId = Number.isFinite(Number(opts.createdImageId)) && Number(opts.createdImageId) > 0
		? Number(opts.createdImageId)
		: parseCreatedImageIdFromHref(detailHref);

	setCommentCountLabel(root, label);

	document.documentElement.dataset.chatDoomCommentsOpen = '1';

	if (window.location.hash !== SHEET_HASH) {
		const st = typeof window.history.state === 'object' && window.history.state !== null ? window.history.state : {};
		window.history.pushState(
			{ ...st, doomCommentsSheet: 1 },
			'',
			`${window.location.pathname}${window.location.search || ''}${SHEET_HASH}`
		);
	}

	root.hidden = false;
	root.setAttribute('aria-hidden', 'false');

	applyOverlaysViewportForCommentsSheet();

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

	void mountThreadIntoSheet(root, {
		createdImageId,
		viewerHint: opts.viewer,
		isAdminHint: opts.isAdmin,
	});
}

async function mountThreadIntoSheet(root, { createdImageId, viewerHint, isAdminHint }) {
	teardownActiveThread();

	const mountEl = root.querySelector('[data-chat-doom-comments-mount]');
	if (!(mountEl instanceof HTMLElement)) return;
	mountEl.innerHTML = '';

	if (!Number.isFinite(createdImageId) || createdImageId <= 0) {
		mountEl.innerHTML = '<p class="chat-doom-comments-error" role="alert">Could not load comments for this creation.</p>';
		return;
	}

	const myMount = (async () => {
		const profilePayload = viewerHint && typeof viewerHint === 'object' ? null : await loadViewerProfile();
		const viewer = normalizeViewer(viewerHint, profilePayload);
		const isAdmin = typeof isAdminHint === 'boolean'
			? isAdminHint
			: Boolean(viewerHint?.role === 'admin' || profilePayload?.role === 'admin');

		const currentMount = overlayEl?.querySelector?.('[data-chat-doom-comments-mount]');
		if (!(currentMount instanceof HTMLElement) || currentMount !== mountEl) return;
		if (overlayEl?.hidden) return;

		const handle = await mountCreationCommentsThread(mountEl, {
			createdImageId,
			viewer,
			isAdmin,
			autoScrollOnHash: false,
			onCommentCountChange: (count) => {
				if (overlayEl) setCommentCountLabel(overlayEl, formatCommentCount(count));
			},
			onCommentsLoadingChange: (loading) => {
				const bodyEl = root.querySelector('[data-chat-doom-comments-body]');
				if (!(bodyEl instanceof HTMLElement)) return;
				if (loading) {
					bodyEl.dataset.chatDoomCommentsBodyScrollLock = '1';
				} else {
					delete bodyEl.dataset.chatDoomCommentsBodyScrollLock;
				}
			},
		});

		if (pendingMount !== myMount) {
			try { handle?.teardown?.(); } catch { /* ignore */ }
			return;
		}
		activeThreadTeardown = handle?.teardown ?? null;
	})().catch((err) => {
		console.error('[doom comments] failed to mount thread:', err);
		mountEl.innerHTML = '<p class="chat-doom-comments-error" role="alert">Could not load comments.</p>';
	});

	pendingMount = myMount;
	await myMount;
	if (pendingMount === myMount) pendingMount = null;
}

export function closeDoomCommentsPopover(opts = {}) {
	restoreViewportAfterCommentsSheet();

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

	teardownActiveThread();
	pendingMount = null;

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
