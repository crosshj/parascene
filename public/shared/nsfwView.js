/**
 * NSFW view preference: session storage key and body class.
 * When the user confirms they want to see NSFW content, we set this and add the class
 * so blur overlays are hidden. Profile modal toggles use localStorage for persistence.
 */
export const NSFW_VIEW_STORAGE_KEY = 'viewNsfw';
export const NSFW_VIEW_BODY_CLASS = 'view-nsfw';

/** localStorage: "Enable NSFW Content" in profile – when true, user can toggle Obscure */
export const NSFW_CONTENT_ENABLED_KEY = 'nsfwContentEnabled';
/** localStorage: "Show NSFW Unobscured" in profile – when true (obscure=false), show; when false (obscure=true), blur */
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

/**
 * Apply body class and sessionStorage from current preferences.
 * Call after changing profile toggles or on app load.
 */
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

/**
 * Apply the view-nsfw body class from profile prefs or legacy session (click-to-reveal).
 * Call once on app load.
 */
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

/**
 * Enable showing NSFW content for this session (storage + body class).
 */
export function enableNsfwView() {
	try {
		sessionStorage.setItem(NSFW_VIEW_STORAGE_KEY, '1');
		document.body.classList.add(NSFW_VIEW_BODY_CLASS);
	} catch (_) {}
}

/**
 * Get creation ID from an element that is inside or is an NSFW overlay/card.
 * On creation-detail page, the hero wrapper may have no data attr; use URL.
 * @param {Element} el - Clicked element or .nsfw element
 * @returns {string|null} - created_image_id or null
 */
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
	// Creation-detail hero: wrapper has .nsfw but no data attr; use current page URL
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

/**
 * Reveal only the given NSFW element (e.g. creation-detail hero). Does not set sessionStorage or body class.
 */
export function revealNsfwElementOnly(nsfwEl) {
	if (nsfwEl?.classList?.contains?.('nsfw')) {
		nsfwEl.classList.add('nsfw-revealed');
	}
}

/**
 * Handle a click that might be on an NSFW overlay. If view is not yet enabled, show confirm
 * and on confirm either reveal only that image (creation-detail) or enable session view and navigate.
 * Returns true if the click was handled (intercepted); false if the caller should allow default behavior.
 * @param {Event} e - Click event
 * @returns {boolean} - True if click was handled (caller should preventDefault/stopPropagation)
 */
export function handleNsfwClick(e) {
	// Don't intercept on feed or grid cards: only navigate to creation detail, never reveal or show confirm
	if (
		e.target?.closest?.('.feed-card') ||
		e.target?.closest?.('.feed-card-image') ||
		e.target?.closest?.('.route-card')
	) return false;
	const creationId = getCreationIdFromNsfwElement(e.target);
	if (!creationId) return false;

	const onDetailPage = typeof window !== 'undefined' && window.location?.pathname?.match?.(/^\/creations\/[^/]+$/);

	// On creation-detail: reveal only when user has enabled NSFW in profile; otherwise swallow click (no reveal).
	if (onDetailPage) {
		if (document.body.dataset.enableNsfw !== '1') return true;
		if (document.body.classList.contains(NSFW_VIEW_BODY_CLASS)) return false;
		const nsfwEl = e.target?.classList?.contains?.('nsfw') ? e.target : e.target?.closest?.('.nsfw');
		if (!nsfwEl) return false;
		if (!window.confirm(NSFW_CONFIRM_MESSAGE_THIS_IMAGE)) return true;
		revealNsfwElementOnly(nsfwEl);
		return true;
	}

	// Else: e.g. NSFW overlay outside cards — confirm then enable session-wide and navigate
	if (document.body.classList.contains(NSFW_VIEW_BODY_CLASS)) return false;
	if (!window.confirm(NSFW_CONFIRM_MESSAGE_SESSION)) return true;
	enableNsfwView();
	window.location.href = `/creations/${creationId}`;
	return true;
}
