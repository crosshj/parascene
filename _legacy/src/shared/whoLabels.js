/**
 * Shared who-list formatting + body-level float tooltips.
 * Shape: ["@a", "@b", 3] → "@a, @b, and 3 others"
 *
 * Float is required because overflow:hidden parents (feed strips, chat scroller,
 * creation-detail action strip, profile lists) clip CSS ::after tooltips.
 */

export function formatWhoTooltip(arr) {
	if (!Array.isArray(arr) || arr.length === 0) return '';
	const last = arr[arr.length - 1];
	const others = typeof last === 'number' ? last : 0;
	const strings = (typeof last === 'number' ? arr.slice(0, -1) : arr).filter((s) => typeof s === 'string' && s);
	if (strings.length === 0 && others <= 0) return '';
	const parts = [...strings];
	if (others > 0) {
		parts.push(`and ${others} ${others === 1 ? 'other' : 'others'}`);
	}
	return parts.join(', ');
}

export function whoListCount(arr) {
	if (!Array.isArray(arr) || arr.length === 0) return 0;
	const last = arr[arr.length - 1];
	const others = typeof last === 'number' ? last : 0;
	const strings = (typeof last === 'number' ? arr.slice(0, -1) : arr).filter((s) => typeof s === 'string');
	return strings.length + others;
}

/**
 * Apply or clear data-tooltip on an element from a who-list array.
 */
export function applyWhoTooltipAttr(el, whoList) {
	if (!(el instanceof HTMLElement)) return;
	const tip = formatWhoTooltip(whoList);
	el.classList.add('who-tooltip');
	if (tip) {
		el.setAttribute('data-tooltip', tip);
	} else {
		el.removeAttribute('data-tooltip');
		el.classList.remove('is-tooltip-visible');
		if (floatAnchor === el) hideFloatingWhoTooltip();
	}
}

const FLOAT_ANCHOR_SEL =
	'.who-tooltip[data-tooltip], .comment-reaction-pill[data-tooltip], .comment-reaction-chip[data-tooltip]';

/** @type {HTMLElement | null} */
let floatEl = null;
/** @type {HTMLElement | null} */
let floatAnchor = null;

function ensureFloatEl() {
	if (typeof document === 'undefined') return null;
	if (floatEl && floatEl.isConnected) return floatEl;
	floatEl = document.createElement('div');
	floatEl.className = 'who-tooltip-float';
	floatEl.setAttribute('role', 'tooltip');
	floatEl.hidden = true;
	(document.body || document.documentElement).appendChild(floatEl);
	return floatEl;
}

function positionFloatingWhoTooltip(anchor) {
	const el = ensureFloatEl();
	if (!(anchor instanceof HTMLElement) || !el) return;
	const tip = anchor.getAttribute('data-tooltip') || '';
	if (!tip) {
		hideFloatingWhoTooltip();
		return;
	}

	el.textContent = tip;
	el.hidden = false;

	const gap = 8;
	const pad = 8;
	const rect = anchor.getBoundingClientRect();
	const tipRect = el.getBoundingClientRect();
	const tipW = tipRect.width || 160;
	const tipH = tipRect.height || 40;

	let left = rect.left + rect.width / 2 - tipW / 2;
	left = Math.max(pad, Math.min(left, window.innerWidth - tipW - pad));
	if (rect.left < tipW / 2 + pad) {
		left = Math.max(pad, Math.min(rect.left, window.innerWidth - tipW - pad));
	}

	let top = rect.top - tipH - gap;
	let place = 'above';
	if (top < pad) {
		top = rect.bottom + gap;
		place = 'below';
	}
	if (top + tipH > window.innerHeight - pad && place === 'below') {
		top = Math.max(pad, rect.top - tipH - gap);
		place = 'above';
	}

	el.style.left = `${Math.round(left)}px`;
	el.style.top = `${Math.round(top)}px`;
	el.dataset.placement = place;
}

export function showFloatingWhoTooltip(anchor) {
	if (!(anchor instanceof HTMLElement)) return;
	if (!anchor.getAttribute('data-tooltip')) return;
	floatAnchor = anchor;
	positionFloatingWhoTooltip(anchor);
}

export function hideFloatingWhoTooltip() {
	floatAnchor = null;
	if (floatEl) {
		floatEl.hidden = true;
		floatEl.textContent = '';
		delete floatEl.dataset.placement;
	}
}

/**
 * Desktop hover + sync with `.is-tooltip-visible` (mobile tap/long-press).
 * Safe to call multiple times; attaches once per container.
 */
export function setupFloatingWhoTooltips(container) {
	const root =
		container instanceof Document
			? container.body || container.documentElement
			: container instanceof HTMLElement
				? container
				: null;
	if (!root) return;

	if (root.dataset.whoFloatAttached === 'true') {
		ensureFloatEl();
		return;
	}
	root.dataset.whoFloatAttached = 'true';
	ensureFloatEl();

	const onScrollOrResize = () => {
		if (floatAnchor && floatEl && !floatEl.hidden) positionFloatingWhoTooltip(floatAnchor);
	};
	window.addEventListener('scroll', onScrollOrResize, true);
	window.addEventListener('resize', onScrollOrResize);

	const showFromEvent = (e) => {
		const anchor = e.target?.closest?.(FLOAT_ANCHOR_SEL);
		if (!anchor || !root.contains(anchor)) return;
		showFloatingWhoTooltip(anchor);
	};

	const hideFromEvent = (e) => {
		const anchor = e.target?.closest?.(FLOAT_ANCHOR_SEL);
		if (!anchor || !root.contains(anchor)) return;
		const next = e.relatedTarget;
		if (next instanceof Node && (anchor.contains(next) || (floatEl && floatEl.contains(next)))) return;
		if (floatAnchor === anchor) hideFloatingWhoTooltip();
	};

	// pointer*: works for mouse and pen; ignore touch (long-press / tap handles mobile).
	root.addEventListener('pointerover', (e) => {
		if (e.pointerType === 'touch') return;
		showFromEvent(e);
	});
	root.addEventListener('pointerout', (e) => {
		if (e.pointerType === 'touch') return;
		hideFromEvent(e);
	});

	// mouse*: backup for environments that don't fire pointer events on hover.
	root.addEventListener('mouseover', showFromEvent);
	root.addEventListener('mouseout', hideFromEvent);

	const mo = new MutationObserver((mutations) => {
		for (const m of mutations) {
			if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
			const el = m.target;
			if (!(el instanceof HTMLElement) || !el.matches?.(FLOAT_ANCHOR_SEL)) continue;
			if (el.classList.contains('is-tooltip-visible') && el.hasAttribute('data-tooltip')) {
				showFloatingWhoTooltip(el);
			} else if (floatAnchor === el) {
				hideFloatingWhoTooltip();
			}
		}
	});
	mo.observe(root, { attributes: true, subtree: true, attributeFilter: ['class'] });
}
