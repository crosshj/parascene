/**
 * Chat Rollup bundle copy — canonical: `public/shared/creationsBulkLongPress.js`.
 */

const DEFAULT_LONG_MS = 420;
const DEFAULT_MOVE_THRESHOLD_PX = 18;

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
	let startX = 0;
	let startY = 0;

	const clearTimer = () => {
		if (timer != null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const releaseCapture = () => {
		if (!(card instanceof HTMLElement) || pointerId == null) return;
		try {
			if (card.hasPointerCapture?.(pointerId)) {
				card.releasePointerCapture(pointerId);
			}
		} catch {
			// ignore
		}
	};

	const clearState = () => {
		clearTimer();
		releaseCapture();
		pointerId = null;
		card = null;
		startX = 0;
		startY = 0;
	};

	const absorbGestureTail = (tailPointerId) => {
		if (tailPointerId == null) return;
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			document.removeEventListener('pointerup', onEnd, true);
			document.removeEventListener('pointercancel', onEnd, true);
			document.removeEventListener('touchend', onEnd, true);
			document.removeEventListener('touchcancel', onEnd, true);
			clearTimeout(fallback);
		};
		const onEnd = (ev) => {
			if (ev.type.startsWith('pointer') && ev.pointerId !== tailPointerId) return;
			try {
				ev.preventDefault();
			} catch {
				// ignore
			}
			try {
				ev.stopPropagation();
			} catch {
				// ignore
			}
			finish();
		};
		document.addEventListener('pointerup', onEnd, true);
		document.addEventListener('pointercancel', onEnd, true);
		document.addEventListener('touchend', onEnd, true);
		document.addEventListener('touchcancel', onEnd, true);
		const fallback = setTimeout(finish, 800);
	};

	const activate = () => {
		timer = null;
		if (!(card instanceof HTMLElement) || !card.isConnected) {
			clearState();
			return;
		}
		const activePointerId = pointerId;
		const activeCard = card;
		try {
			if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
				navigator.vibrate(12);
			}
		} catch {
			// ignore
		}
		onLongPress(activeCard);
		absorbGestureTail(activePointerId);
		clearState();
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

			timer = setTimeout(activate, longPressMs);
		},
		{ ...opts, passive: false }
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

	const onPointerEnd = (e) => {
		if (pointerId == null || e.pointerId !== pointerId) return;
		clearState();
	};

	container.addEventListener('pointerup', onPointerEnd, opts);
	container.addEventListener('pointercancel', onPointerEnd, opts);

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
