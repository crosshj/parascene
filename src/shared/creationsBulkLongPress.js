/**
 * Chat Rollup bundle copy — canonical: `public/shared/creationsBulkLongPress.js`.
 */

const DEFAULT_LONG_MS = 420;
const DEFAULT_MOVE_THRESHOLD_PX = 18;
const GHOST_CLICK_MS = 520;
/** Set on the card while a bulk long-press is armed (before pointerup). */
export const CREATIONS_BULK_LONG_PRESS_ARMED_ATTR = 'data-creations-bulk-long-press';

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container
 * @param {string} opts.cardSelector
 * @param {() => boolean} opts.isEnabled
 * @param {() => boolean} opts.isBulkActive
 * @param {(card: HTMLElement) => void} opts.onLongPress
 * @param {(target: EventTarget | null) => boolean} [opts.shouldIgnoreTarget]
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.longPressMs]
 * @returns {{ cancel: () => void } | undefined}
 */
export function bindMobileCreationsBulkLongPress({
	container,
	cardSelector,
	isEnabled,
	isBulkActive,
	onLongPress,
	shouldIgnoreTarget,
	signal,
	longPressMs = DEFAULT_LONG_MS
}) {
	if (!(container instanceof HTMLElement)) return;
	if (typeof cardSelector !== 'string' || !cardSelector.trim()) return;
	if (typeof isEnabled !== 'function' || typeof isBulkActive !== 'function') return;
	if (typeof onLongPress !== 'function') return;

	const ignore =
		typeof shouldIgnoreTarget === 'function'
			? shouldIgnoreTarget
			: (target) =>
					Boolean(
						target &&
							/** @type {Element} */ (target).closest?.(
								'a,button,input,textarea,select,label,[role="button"],video,.feed-card-video,.feed-card-group-nav'
							)
					);

	const moveThresholdSq = DEFAULT_MOVE_THRESHOLD_PX * DEFAULT_MOVE_THRESHOLD_PX;
	let timer = null;
	/** @type {number | null} */
	let pointerId = null;
	/** @type {HTMLElement | null} */
	let card = null;
	/** @type {HTMLElement | null} */
	let armedCard = null;
	let startX = 0;
	let startY = 0;

	const clearTimer = () => {
		if (timer != null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const releaseCapture = (capCard, capPointerId) => {
		if (!(capCard instanceof HTMLElement) || capPointerId == null) return;
		try {
			if (capCard.hasPointerCapture?.(capPointerId)) {
				capCard.releasePointerCapture(capPointerId);
			}
		} catch {
			// ignore
		}
	};

	const clearBulkLongPressArmed = (el) => {
		if (el instanceof HTMLElement) {
			el.removeAttribute(CREATIONS_BULK_LONG_PRESS_ARMED_ATTR);
		}
	};

	const clearState = () => {
		clearTimer();
		const capCard = card;
		const capPointerId = pointerId;
		clearBulkLongPressArmed(capCard);
		pointerId = null;
		card = null;
		armedCard = null;
		startX = 0;
		startY = 0;
		releaseCapture(capCard, capPointerId);
	};

	const blockGhostClick = (targetCard) => {
		if (!(targetCard instanceof HTMLElement)) return;
		const until = Date.now() + GHOST_CLICK_MS;
		const onClick = (ev) => {
			if (Date.now() > until) {
				document.removeEventListener('click', onClick, true);
				return;
			}
			const t = ev.target;
			if (!(t instanceof Node)) return;
			if (targetCard === t || targetCard.contains(t)) {
				ev.preventDefault();
				ev.stopPropagation();
			}
		};
		document.addEventListener('click', onClick, true);
		setTimeout(() => document.removeEventListener('click', onClick, true), GHOST_CLICK_MS + 40);
	};

	const armLongPress = () => {
		timer = null;
		if (!(card instanceof HTMLElement) || !card.isConnected) {
			clearState();
			return;
		}
		try {
			if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
				navigator.vibrate(12);
			}
		} catch {
			// ignore
		}
		card.setAttribute(CREATIONS_BULK_LONG_PRESS_ARMED_ATTR, 'armed');
		armedCard = card;
	};

	const finishPointer = (e) => {
		if (pointerId == null || e.pointerId !== pointerId) return;
		const armed = armedCard instanceof HTMLElement ? armedCard : null;
		clearState();
		if (!(armed instanceof HTMLElement)) return;
		try {
			e.preventDefault();
		} catch {
			// ignore
		}
		try {
			e.stopPropagation();
		} catch {
			// ignore
		}
		onLongPress(armed);
		blockGhostClick(armed);
	};

	if (signal) {
		if (signal.aborted) {
			clearState();
			return { cancel: clearState };
		}
		signal.addEventListener('abort', clearState, { once: true });
	}

	const opts = signal ? { signal } : undefined;

	container.addEventListener(
		'pointerdown',
		(e) => {
			if (!isEnabled()) return;
			if (isBulkActive()) return;
			if (e.pointerType === 'mouse') return;
			if (ignore(e.target)) return;
			const hit = e.target?.closest?.(cardSelector);
			if (!(hit instanceof HTMLElement)) return;

			clearState();
			pointerId = e.pointerId;
			card = hit;
			startX = Number(e.clientX) || 0;
			startY = Number(e.clientY) || 0;

			try {
				card.setPointerCapture(e.pointerId);
			} catch {
				// ignore
			}

			timer = setTimeout(armLongPress, longPressMs);
		},
		opts
	);

	container.addEventListener(
		'pointermove',
		(e) => {
			if (pointerId == null || e.pointerId !== pointerId) return;
			const dx = (Number(e.clientX) || 0) - startX;
			const dy = (Number(e.clientY) || 0) - startY;
			if (dx * dx + dy * dy > moveThresholdSq) {
				clearState();
			}
		},
		opts
	);

	container.addEventListener('pointerup', finishPointer, opts);
	container.addEventListener('pointercancel', finishPointer, opts);

	container.addEventListener(
		'contextmenu',
		(e) => {
			if (!isEnabled()) return;
			if (!e.target?.closest?.(cardSelector)) return;
			if (ignore(e.target)) return;
			e.preventDefault();
			e.stopPropagation();
		},
		{ capture: true, ...opts }
	);

	return { cancel: clearState };
}
