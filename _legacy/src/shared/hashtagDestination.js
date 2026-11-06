/**
 * Shared #hashtag destination: channel-vs-tag chooser + specials.
 * Used by chat bubbles, creation detail (standalone), and chat overlay embeds.
 */

import { helpIcon } from '/icons/svg-strings.js';

/** postMessage from embed iframe → chat shell parent */
export const CHAT_HASHTAG_INTENT_MESSAGE = 'prsn-chat-hashtag-intent';

/** Special #tokens that skip /t/:slug (keep in sync with processUserText). */
export const SPECIAL_HASHTAG_HREFS = Object.freeze({
	create: '/create',
	feed: '/feed',
	help: '/help',
	creations: '/chat/c/creations',
	creation: '/chat/c/creations',
	challenges: '/challenges',
	notes: '/chat/notes',
	explore: '/explore',
	comments: '/chat/c/comments',
	feedback: '/chat/c/feedback',
});

/** @type {null | (() => void)} */
let hashtagChoiceModalCleanup = null;

export function normalizeHashtagSlug(slug) {
	return String(slug || '')
		.trim()
		.toLowerCase();
}

/**
 * @param {string} slug
 * @returns {{ kind: 'path', href: string } | null}
 */
export function resolveSpecialHashtagDestination(slug) {
	const key = normalizeHashtagSlug(slug);
	if (!key) return null;
	const href = SPECIAL_HASHTAG_HREFS[key];
	if (!href) return null;
	return { kind: 'path', href };
}

/**
 * Parse a /t/:slug path or href. Returns normalized slug or null.
 * @param {string} hrefOrPath
 */
export function parseHashtagSlugFromTagPath(hrefOrPath) {
	const raw = String(hrefOrPath || '').trim();
	if (!raw) return null;
	let pathOnly = raw;
	try {
		if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) {
			pathOnly = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'https://local.invalid')
				.pathname;
		}
	} catch {
		pathOnly = raw.split('?')[0].split('#')[0];
	}
	pathOnly = String(pathOnly || '').split('?')[0].split('#')[0];
	const m = pathOnly.match(/^\/t\/([^/]+)$/i);
	if (!m) return null;
	try {
		return normalizeHashtagSlug(decodeURIComponent(m[1]));
	} catch {
		return normalizeHashtagSlug(m[1]);
	}
}

/**
 * True when this frame is creation-detail embed under the chat SPA (same-origin).
 * Cross-origin parent access fails closed → caller should handle locally.
 */
export function shouldDelegateHashtagIntentToParentChatShell() {
	try {
		if (typeof window === 'undefined' || window.parent === window) return false;
		if (window.__ps_creation_detail_embed !== true) return false;
		const parentDoc = window.parent.document;
		const body = parentDoc?.body;
		if (!(body instanceof HTMLElement)) return false;
		const onChatPage =
			body.classList.contains('chat-page') ||
			parentDoc.documentElement?.classList?.contains('chat-page') ||
			body.dataset?.entry === 'chat';
		return onChatPage && Boolean(parentDoc.querySelector('[data-chat-page]'));
	} catch {
		return false;
	}
}

export function closeHashtagChoiceModal() {
	if (typeof hashtagChoiceModalCleanup === 'function') {
		hashtagChoiceModalCleanup();
		hashtagChoiceModalCleanup = null;
	}
}

/**
 * @param {string} slug
 * @param {{
 *   onPickChannel: (slug: string) => void | Promise<void>,
 *   onPickTag: (slug: string) => void | Promise<void>,
 * }} handlers
 */
export function showHashtagChoiceModal(slug, handlers) {
	closeHashtagChoiceModal();
	const safe = normalizeHashtagSlug(slug);
	if (!safe) return;

	const onPickChannel = typeof handlers?.onPickChannel === 'function' ? handlers.onPickChannel : null;
	const onPickTag = typeof handlers?.onPickTag === 'function' ? handlers.onPickTag : null;

	const label = `#${safe}`;
	const overlay = document.createElement('div');
	overlay.className = 'chat-hashtag-nav-overlay';
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-labelledby', 'chat-hashtag-nav-title');
	overlay.setAttribute('aria-describedby', 'chat-hashtag-nav-desc');

	const panel = document.createElement('div');
	panel.className = 'chat-hashtag-nav-dialog';

	const header = document.createElement('div');
	header.className = 'chat-hashtag-nav-header';

	const title = document.createElement('h2');
	title.id = 'chat-hashtag-nav-title';
	title.className = 'chat-hashtag-nav-title';
	title.textContent = label;

	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'chat-hashtag-nav-close';
	closeBtn.setAttribute('aria-label', 'Close');
	closeBtn.title = 'Close (Esc)';
	closeBtn.textContent = '×';
	closeBtn.addEventListener('click', () => closeHashtagChoiceModal());

	header.appendChild(title);
	header.appendChild(closeBtn);

	const lead = document.createElement('div');
	lead.className = 'chat-hashtag-nav-lead';

	const illust = document.createElement('div');
	illust.className = 'chat-hashtag-nav-illustration';
	illust.innerHTML = helpIcon('chat-hashtag-nav-illustration-svg');

	const hint = document.createElement('p');
	hint.id = 'chat-hashtag-nav-desc';
	hint.className = 'chat-hashtag-nav-hint';
	hint.textContent = 'Where would you like to go?';

	lead.appendChild(illust);
	lead.appendChild(hint);

	const actions = document.createElement('div');
	actions.className = 'chat-hashtag-nav-actions';

	const btnChannel = document.createElement('button');
	btnChannel.type = 'button';
	btnChannel.className = 'btn-primary chat-hashtag-nav-btn chat-hashtag-nav-btn--channel';
	btnChannel.setAttribute('data-chat-hashtag-pick', 'channel');
	btnChannel.textContent = 'Channel';

	const btnTag = document.createElement('button');
	btnTag.type = 'button';
	btnTag.className = 'btn-secondary chat-hashtag-nav-btn chat-hashtag-nav-btn--tag';
	btnTag.setAttribute('data-chat-hashtag-pick', 'tag');
	btnTag.textContent = 'Tag page';

	actions.appendChild(btnTag);
	actions.appendChild(btnChannel);
	panel.appendChild(header);
	panel.appendChild(lead);
	panel.appendChild(actions);
	overlay.appendChild(panel);

	const onKeydown = (ev) => {
		if (ev.key === 'Escape') {
			ev.preventDefault();
			ev.stopPropagation();
			closeHashtagChoiceModal();
		}
	};

	hashtagChoiceModalCleanup = () => {
		document.removeEventListener('keydown', onKeydown, true);
		if (overlay.parentNode) {
			overlay.parentNode.removeChild(overlay);
		}
		try {
			document.body.classList.remove('chat-hashtag-nav-open');
		} catch {
			// ignore
		}
	};

	document.addEventListener('keydown', onKeydown, true);
	overlay.addEventListener('click', (ev) => {
		if (ev.target === overlay) {
			closeHashtagChoiceModal();
		}
	});
	btnChannel.addEventListener('click', () => {
		closeHashtagChoiceModal();
		if (onPickChannel) void onPickChannel(safe);
	});
	btnTag.addEventListener('click', () => {
		closeHashtagChoiceModal();
		if (onPickTag) void onPickTag(safe);
	});

	document.body.appendChild(overlay);
	try {
		document.body.classList.add('chat-hashtag-nav-open');
	} catch {
		// ignore
	}
	requestAnimationFrame(() => {
		try {
			btnChannel.focus({ preventScroll: true });
		} catch {
			btnChannel.focus();
		}
	});
}

/**
 * @param {string} slug
 * @returns {Promise<boolean>}
 */
async function fetchHashtagChannelExists(slug) {
	const safe = normalizeHashtagSlug(slug);
	if (!safe) return false;
	const res = await fetch(`/api/chat/hashtag-channel-exists/${encodeURIComponent(safe)}`, {
		credentials: 'include',
	});
	if (res.status === 401) return false;
	const data = await res.json().catch(() => ({}));
	if (!res.ok) return false;
	return data.channelExists === true;
}

/**
 * Resolve a hashtag click: specials, channel-vs-tag chooser, or tag page.
 * @param {string} slug
 * @param {{
 *   navigate: (href: string) => void | Promise<void>,
 *   onBeforeChoice?: () => void,
 * }} options
 */
export async function openHashtagDestination(slug, options) {
	const safe = normalizeHashtagSlug(slug);
	if (!safe) return;

	const navigate = typeof options?.navigate === 'function' ? options.navigate : null;
	if (!navigate) return;
	const onBeforeChoice = typeof options?.onBeforeChoice === 'function' ? options.onBeforeChoice : null;

	const go = async (href) => {
		const target = String(href || '').trim();
		if (!target) return;
		await navigate(target);
	};

	const special = resolveSpecialHashtagDestination(safe);
	if (special?.kind === 'path' && special.href) {
		await go(special.href);
		return;
	}

	const tagHref = `/t/${encodeURIComponent(safe)}`;
	const channelHref = `/chat/c/${encodeURIComponent(safe)}`;

	try {
		const exists = await fetchHashtagChannelExists(safe);
		if (exists) {
			if (onBeforeChoice) onBeforeChoice();
			showHashtagChoiceModal(safe, {
				onPickChannel: () => go(channelHref),
				onPickTag: () => go(tagHref),
			});
			return;
		}
	} catch {
		// fall through to tag page
	}
	await go(tagHref);
}
