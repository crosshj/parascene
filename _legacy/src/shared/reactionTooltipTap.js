import { setupFloatingWhoTooltips, hideFloatingWhoTooltip } from './whoLabels.js';

/**
 * Who-tooltips on mobile:
 * - Tap (no conflict): chips/counts with data-who-tap="1" or readonly reaction chips
 * - Long-press: interactive pills / comment buttons / like buttons with data-tooltip
 *
 * Safe to call multiple times; only attaches once per container.
 */

const WHO_TOOLTIP_SEL =
	'.comment-reaction-chip[data-tooltip], .comment-reaction-pill[data-tooltip], .who-tooltip[data-tooltip], [data-tooltip].who-tooltip';

const TAP_SHOW_SEL =
	'.comment-reaction-chip[data-tooltip], .comment-reactions-readonly .comment-reaction-pill[data-tooltip], .who-tooltip[data-tooltip][data-who-tap="1"]';

const LONG_PRESS_SEL =
	'.comment-reaction-pill[data-tooltip], [data-tooltip][data-who-longpress="1"], button[data-like-button][data-tooltip], button[data-comment-button][data-tooltip], a[data-chat-doom-comments][data-tooltip]';

const LONG_PRESS_MS = 450;

function closeTooltipsIn(container, onOutsideClick) {
	container.querySelectorAll(`${WHO_TOOLTIP_SEL}.is-tooltip-visible, [data-tooltip].is-tooltip-visible`).forEach((el) => {
		el.classList.remove('is-tooltip-visible');
	});
	document.removeEventListener('click', onOutsideClick);
	hideFloatingWhoTooltip();
}

/**
 * Tap-to-show for readonly chips and like counts (data-who-tap="1").
 * Dismiss: tap again on the chip, or tap anywhere else.
 */
export function setupReactionTooltipTap(container) {
	if (!container || container.dataset.reactionTooltipAttached === 'true') return;
	container.dataset.reactionTooltipAttached = 'true';

	const onDismissTap = () => {
		closeTooltipsIn(container, onDismissTap);
	};

	container.addEventListener('click', (e) => {
		const chip = e.target?.closest?.(TAP_SHOW_SEL);
		if (!chip || !container.contains(chip)) {
			closeTooltipsIn(container, onDismissTap);
			return;
		}
		// Don't steal clicks on interactive pills (those use long-press).
		if (chip.matches('.comment-reaction-pill') && !chip.closest('.comment-reactions-readonly')) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		const wasVisible = chip.classList.contains('is-tooltip-visible');
		closeTooltipsIn(container, onDismissTap);
		if (!wasVisible) {
			chip.classList.add('is-tooltip-visible');
			requestAnimationFrame(() => document.addEventListener('click', onDismissTap));
		}
	});
}

/**
 * Long-press to show who on interactive reaction pills, comment buttons, etc.
 * Short tap is left to existing handlers (toggle / navigate).
 * Dismiss: tap anywhere (or scroll) after it opens.
 */
export function setupReactionTooltipLongPress(container) {
	if (!container || container.dataset.reactionLongPressAttached === 'true') return;
	container.dataset.reactionLongPressAttached = 'true';

	const onDismissTap = () => {
		closeTooltipsIn(container, onDismissTap);
		document.removeEventListener('scroll', onDismissScroll, true);
	};

	const onDismissScroll = () => {
		closeTooltipsIn(container, onDismissTap);
		document.removeEventListener('scroll', onDismissScroll, true);
	};

	const armDismiss = () => {
		requestAnimationFrame(() => {
			document.addEventListener('click', onDismissTap);
			document.addEventListener('scroll', onDismissScroll, true);
		});
	};

	let timer = null;
	let targetEl = null;
	let didLongPress = false;

	const clear = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		targetEl = null;
	};

	const onStart = (e) => {
		const el = e.target?.closest?.(LONG_PRESS_SEL);
		if (!el || !container.contains(el) || !el.hasAttribute('data-tooltip')) return;
		if (el.closest('.comment-reactions-readonly')) return;
		didLongPress = false;
		targetEl = el;
		timer = setTimeout(() => {
			timer = null;
			if (!targetEl) return;
			didLongPress = true;
			closeTooltipsIn(container, onDismissTap);
			document.removeEventListener('scroll', onDismissScroll, true);
			targetEl.classList.add('is-tooltip-visible');
			armDismiss();
			try {
				if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10);
			} catch {
				// ignore
			}
		}, LONG_PRESS_MS);
	};

	const onMove = () => {
		clear();
	};

	const onEnd = (e) => {
		const wasLong = didLongPress;
		const el = targetEl;
		clear();
		if (wasLong) {
			e.preventDefault();
			e.stopPropagation();
			if (el) {
				el.dataset.whoLongPressSuppressClick = '1';
				setTimeout(() => {
					delete el.dataset.whoLongPressSuppressClick;
				}, 400);
			}
		}
		didLongPress = false;
	};

	container.addEventListener(
		'click',
		(e) => {
			const el = e.target?.closest?.(LONG_PRESS_SEL);
			if (el?.dataset?.whoLongPressSuppressClick === '1') {
				e.preventDefault();
				e.stopPropagation();
				delete el.dataset.whoLongPressSuppressClick;
			}
		},
		true
	);

	container.addEventListener('touchstart', onStart, { passive: true });
	container.addEventListener('touchmove', onMove, { passive: true });
	container.addEventListener('touchend', onEnd, { passive: false });
	container.addEventListener('touchcancel', clear, { passive: true });

	// Pointer long-press for hybrid devices without reliable hover.
	container.addEventListener('pointerdown', (e) => {
		if (e.pointerType === 'mouse') return;
		onStart(e);
	});
	container.addEventListener('pointerup', (e) => {
		if (e.pointerType === 'mouse') return;
		onEnd(e);
	});
	container.addEventListener('pointercancel', clear);
}

/**
 * Attach both tap and long-press who-tooltip handlers + floating hover layer.
 */
export function setupWhoTooltips(container) {
	setupReactionTooltipTap(container);
	setupReactionTooltipLongPress(container);
	setupFloatingWhoTooltips(container);
}
