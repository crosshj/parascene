/**
 * Nested Escape-layer detection for SPA page overlays.
 *
 * Embed pages close the parent overlay on Escape unless a nested layer is open.
 * Layers often open with `.open` + `removeAttribute('aria-hidden')`, so checking
 * only `aria-hidden === 'false'` misses them — use {@link isEscapeLayerOpen}.
 */

/**
 * @param {Element | null | undefined} el
 * @returns {boolean}
 */
export function isEscapeLayerOpen(el) {
	if (!(el instanceof HTMLElement) || el.hidden) return false;
	if (el instanceof HTMLDialogElement) return Boolean(el.open);
	if (el.classList.contains('open')) return true;
	const aria = el.getAttribute('aria-hidden');
	if (aria === 'false') return true;
	// Present in DOM without aria-hidden="true" and not display:none — used by import modals.
	if (aria == null && el.hasAttribute('data-import-suno-modal')) return true;
	return false;
}

/**
 * Standardize open/close for overlay-style layers.
 * @param {HTMLElement | null | undefined} el
 * @param {boolean} open
 */
export function setEscapeLayerOpen(el, open) {
	if (!(el instanceof HTMLElement)) return;
	if (open) {
		el.classList.add('open');
		el.setAttribute('aria-hidden', 'false');
		el.hidden = false;
	} else {
		el.classList.remove('open');
		el.setAttribute('aria-hidden', 'true');
	}
}

/** Selectors for layers that should consume Escape before the SPA overlay closes. */
export const NESTED_ESCAPE_LAYER_SELECTORS = [
	'.chat-inline-image-lightbox',
	'.chat-hashtag-nav-overlay',
	'[data-lineage-modal]',
	'[data-set-avatar-modal]',
	'[data-adjust-image-modal]',
	'[data-queue-from-frame-modal]',
		'[data-challenge-submit-modal]',
	'[data-organizer-assign-modal]',
	'[data-import-suno-modal]',
	'.comment-sticker-modal-overlay',
	'.comment-attach-popover',
	'[data-create-model-popover]',
	'[data-create-aspect-popover]',
	'[data-creation-more-menu]',
	'.create-route-advanced-confirm',
	'[data-advanced-confirm-dialog]',
	'[data-advanced-preview-dialog]',
	'[data-blog-campaign-dialog]',
	'[data-creation-edit-i2v-modal]',
	'[data-profile-edit-overlay]',
	'[data-persona-library-edit-overlay]',
	'[data-profile-generate-confirm-overlay]',
	'[data-persona-library-generate-confirm-overlay]',
	'.image-picker-modal-overlay',
	'.audio-clip-picker-modal-overlay',
	'.audio-clip-edit-modal-overlay',
	'.adjust-image-modal',
	'.queue-from-frame-modal'
];

/**
 * @param {ParentNode} [root]
 * @returns {boolean}
 */
export function documentHasNestedEscapeLayer(root = document) {
	const scope = root || document;
	for (const sel of NESTED_ESCAPE_LAYER_SELECTORS) {
		let nodes;
		try {
			nodes = scope.querySelectorAll(sel);
		} catch {
			continue;
		}
		for (const node of nodes) {
			if (!(node instanceof HTMLElement)) continue;
			// Confirm overlays that use [hidden] instead of aria-hidden.
			if (node.hasAttribute('hidden') && node.hidden) continue;
			if (node.getAttribute('aria-hidden') === 'true' && !node.classList.contains('open')) {
				continue;
			}
			if (isEscapeLayerOpen(node)) return true;
			// Popovers / import overlays that exist in the DOM while open.
			if (
				node.classList.contains('comment-attach-popover') ||
				node.hasAttribute('data-import-suno-modal')
			) {
				return true;
			}
			// More menu uses aria-hidden only.
			if (
				node.hasAttribute('data-creation-more-menu') &&
				node.getAttribute('aria-hidden') === 'false'
			) {
				return true;
			}
			// Profile generate confirm uses [hidden].
			if (
				(node.hasAttribute('data-profile-generate-confirm-overlay') ||
					node.hasAttribute('data-persona-library-generate-confirm-overlay')) &&
				!node.hidden
			) {
				return true;
			}
		}
	}

	try {
		for (const dialog of scope.querySelectorAll('dialog')) {
			if (dialog instanceof HTMLDialogElement && dialog.open) return true;
		}
	} catch {
		// ignore
	}

	return false;
}

/**
 * @param {...(() => boolean)|null|undefined} gates
 * @returns {() => boolean}
 */
export function combineEscapeGates(...gates) {
	return () => {
		for (const gate of gates) {
			if (typeof gate === 'function' && gate()) return true;
		}
		return documentHasNestedEscapeLayer();
	};
}

/**
 * Dispatch Escape into a same-origin iframe so nested handlers can run.
 * @param {HTMLIFrameElement | null | undefined} frame
 * @returns {boolean} true if a nested layer was present (and event was dispatched)
 */
export function forwardEscapeIntoOverlayFrame(frame) {
	if (!(frame instanceof HTMLIFrameElement)) return false;
	let doc = null;
	try {
		doc = frame.contentDocument;
	} catch {
		return false;
	}
	if (!doc) return false;
	if (!documentHasNestedEscapeLayer(doc)) return false;
	try {
		doc.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Escape',
				code: 'Escape',
				bubbles: true,
				cancelable: true
			})
		);
	} catch {
		return false;
	}
	return true;
}
