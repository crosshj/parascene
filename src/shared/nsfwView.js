/**
 * NSFW preferences and click handling (Rollup bundle copy; keep in sync with `public/shared/nsfwView.js`).
 */

/**
 * NSFW view preference: session storage key and body class.
 * When the user confirms they want to see NSFW content, we set this and add the class
 * so blur overlays are hidden. Profile modal toggles use localStorage for persistence.
 */
export const NSFW_VIEW_STORAGE_KEY = 'viewNsfw';
export const NSFW_VIEW_BODY_CLASS = 'view-nsfw';

export const NSFW_CONTENT_ENABLED_KEY = 'nsfwContentEnabled';
export const NSFW_OBSCURE_KEY = 'nsfwObscure';

export function getNsfwContentEnabled() {
	try {
		return localStorage.getItem(NSFW_CONTENT_ENABLED_KEY) === '1';
	} catch (_) {
		return false;
	}
}

export function setNsfwContentEnabled(value) {
	try {
		if (value) localStorage.setItem(NSFW_CONTENT_ENABLED_KEY, '1');
		else localStorage.removeItem(NSFW_CONTENT_ENABLED_KEY);
	} catch (_) {}
}

export function getNsfwObscure() {
	try {
		const v = localStorage.getItem(NSFW_OBSCURE_KEY);
		return v !== '0' && v !== 'false';
	} catch (_) {
		return true;
	}
}

export function setNsfwObscure(value) {
	try {
		if (value) localStorage.setItem(NSFW_OBSCURE_KEY, '1');
		else localStorage.setItem(NSFW_OBSCURE_KEY, '0');
	} catch (_) {}
}

export function applyNsfwPreference() {
	try {
		const enabled = getNsfwContentEnabled();
		const obscure = getNsfwObscure();
		const showNsfw = enabled && !obscure;
		if (showNsfw) {
			sessionStorage.setItem(NSFW_VIEW_STORAGE_KEY, '1');
			document.body.classList.add(NSFW_VIEW_BODY_CLASS);
		} else {
			sessionStorage.removeItem(NSFW_VIEW_STORAGE_KEY);
			document.body.classList.remove(NSFW_VIEW_BODY_CLASS);
		}
	} catch (_) {}
}

export function initNsfwViewPreference() {
	try {
		const enabled = getNsfwContentEnabled();
		const obscure = getNsfwObscure();
		if (enabled && !obscure) {
			document.body.classList.add(NSFW_VIEW_BODY_CLASS);
			sessionStorage.setItem(NSFW_VIEW_STORAGE_KEY, '1');
			return;
		}
		if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(NSFW_VIEW_STORAGE_KEY)) {
			document.body.classList.add(NSFW_VIEW_BODY_CLASS);
		}
	} catch (_) {}
}

export function enableNsfwView() {
	try {
		sessionStorage.setItem(NSFW_VIEW_STORAGE_KEY, '1');
		document.body.classList.add(NSFW_VIEW_BODY_CLASS);
	} catch (_) {}
}

export function getCreationIdFromNsfwElement(el) {
	if (!el || typeof el.closest !== 'function') return null;
	const nsfwEl = el.classList?.contains('nsfw') ? el : el.closest('.nsfw');
	if (!nsfwEl) return null;
	let id =
		nsfwEl.getAttribute('data-image-id') ||
		nsfwEl.getAttribute('data-creation-id') ||
		nsfwEl.querySelector?.('[data-image-id]')?.getAttribute('data-image-id') ||
		nsfwEl.closest?.('[data-creation-id]')?.getAttribute('data-creation-id') ||
		nsfwEl.closest?.('[data-image-id]')?.getAttribute('data-image-id');
	if (id != null && id !== '') return String(id);
	if (nsfwEl.closest?.('.creation-detail-image-wrapper') === nsfwEl || nsfwEl.classList?.contains('creation-detail-image-wrapper')) {
		const m = typeof window !== 'undefined' && window.location?.pathname?.match?.(/\/creations\/([^/?#]+)/);
		if (m?.[1]) return m[1];
	}
	return null;
}

const NSFW_CONFIRM_MESSAGE_SESSION =
	'This will enable showing NSFW content for this session. Blurred content will be visible until you close this tab. Continue?';
const NSFW_CONFIRM_MESSAGE_THIS_IMAGE =
	'Do you want to temporarily reveal this item?';

export function revealNsfwElementOnly(nsfwEl) {
	if (nsfwEl?.classList?.contains?.('nsfw')) {
		nsfwEl.classList.add('nsfw-revealed');
	}
}

/**
 * Reveal every blurred NSFW surface for the current creation-detail item at once:
 * the hero (single image or carousel) and all grouped-source thumbnails. Used so that
 * confirming on either the hero/carousel or a thumbnail unblurs the whole item together.
 */
export function revealCreationDetailNsfw() {
	try {
		const els = document.querySelectorAll(
			'.creation-detail-image-wrapper.nsfw, .creation-detail-group-thumb-wrap.nsfw'
		);
		els.forEach((el) => el.classList.add('nsfw-revealed'));
	} catch (_) {}
}

export function handleNsfwClick(e) {
	if (
		e.target?.closest?.('.feed-card') ||
		e.target?.closest?.('.feed-card-image') ||
		e.target?.closest?.('.route-card')
	) return false;
	if (e.target?.closest?.('.creation-detail-history-thumb-link')) return false;

	const chatEmbedNsfw = e.target?.closest?.(
		'.connect-chat-creation-embed .nsfw:not(.nsfw-revealed)'
	);
	if (chatEmbedNsfw) {
		if (document.body.classList.contains(NSFW_VIEW_BODY_CLASS)) return false;
		if (!getNsfwContentEnabled()) return false;
		if (!window.confirm(NSFW_CONFIRM_MESSAGE_THIS_IMAGE)) return true;
		revealNsfwElementOnly(chatEmbedNsfw);
		return true;
	}

	const doomSlideNsfw = e.target?.closest?.('.chat-doom-slide-media-frame.nsfw:not(.nsfw-revealed)');
	if (doomSlideNsfw) {
		if (document.body.classList.contains(NSFW_VIEW_BODY_CLASS)) return false;
		if (!getNsfwContentEnabled()) return false;
		if (!window.confirm(NSFW_CONFIRM_MESSAGE_THIS_IMAGE)) return true;
		revealNsfwElementOnly(doomSlideNsfw);
		doomSlideNsfw.dispatchEvent(new CustomEvent('prsn-doom-nsfw-revealed', { bubbles: true }));
		return true;
	}

	/* Revealed doom clip: do not fall through to creationId/session confirm — allow pause/play. */
	if (e.target?.closest?.('.chat-doom-slide-media-frame.nsfw.nsfw-revealed')) return false;

	const onDetailPage = typeof window !== 'undefined' && window.location?.pathname?.match?.(/^\/creations\/[^/]+$/);

	if (onDetailPage) {
		if (document.body.classList.contains(NSFW_VIEW_BODY_CLASS)) return false;
		/* Revealed hero/thumb: allow play/pause, mute, group nav, carousel switch — no repeat confirm. */
		if (e.target?.closest?.('.creation-detail-image-wrapper.nsfw.nsfw-revealed')) return false;
		if (e.target?.closest?.('.creation-detail-group-thumb-wrap.nsfw.nsfw-revealed')) return false;
		const nsfwEl =
			e.target?.closest?.('.creation-detail-image-wrapper.nsfw:not(.nsfw-revealed)') ||
			e.target?.closest?.('.creation-detail-group-thumb-wrap.nsfw:not(.nsfw-revealed)');
		if (!nsfwEl) return false;
		if (document.body.dataset.enableNsfw !== '1') return true;
		if (!window.confirm(NSFW_CONFIRM_MESSAGE_THIS_IMAGE)) return true;
		/* Reveal hero + every grouped thumbnail together so the whole item unblurs at once. */
		revealCreationDetailNsfw();
		return true;
	}

	const creationId = getCreationIdFromNsfwElement(e.target);
	if (!creationId) return false;

	if (e.target?.closest?.('.connect-chat-creation-embed')) return false;
	if (document.body.classList.contains(NSFW_VIEW_BODY_CLASS)) return false;
	if (!window.confirm(NSFW_CONFIRM_MESSAGE_SESSION)) return true;
	enableNsfwView();
	window.location.href = `/creations/${creationId}`;
	return true;
}
