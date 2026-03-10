/**
 * Enables tap-to-show for reaction tooltips on mobile (chips with data-tooltip).
 * Call after rendering comments. Safe to call multiple times; only attaches once per container.
 */
export function setupReactionTooltipTap(container) {
	if (!container || container.dataset.reactionTooltipAttached === 'true') return;
	container.dataset.reactionTooltipAttached = 'true';

	const closeAll = () => {
		container.querySelectorAll('.comment-reaction-chip.is-tooltip-visible, .comment-reaction-pill.is-tooltip-visible').forEach((el) => el.classList.remove('is-tooltip-visible'));
		document.removeEventListener('click', onOutsideClick);
	};

	const onOutsideClick = (e) => {
		if (!container.contains(e.target)) closeAll();
	};

	container.addEventListener('click', (e) => {
		const chip = e.target?.closest?.('.comment-reaction-chip[data-tooltip], .comment-reaction-pill[data-tooltip]');
		if (!chip) {
			closeAll();
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		const wasVisible = chip.classList.contains('is-tooltip-visible');
		closeAll();
		if (!wasVisible) {
			chip.classList.add('is-tooltip-visible');
			requestAnimationFrame(() => document.addEventListener('click', onOutsideClick));
		}
	});
}
