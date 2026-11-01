/**
 * Standard app-dialog for challenge prize payout:
 * confirm → loading → success / error.
 */

import { createModalDismissButton } from '../../shared/modalDismiss.js';

/**
 * @typedef {'confirm' | 'loading' | 'success' | 'error'} PayoutModalPhase
 */

/**
 * @param {{
 *   count: number,
 *   total: number,
 * }} opts
 * @returns {{
 *   waitForConfirm: () => Promise<boolean>,
 *   setLoading: (message?: string) => void,
 *   setSuccess: (message: string) => void,
 *   setError: (message: string) => void,
 *   close: () => void,
 * }}
 */
export function openPayoutProgressModal({ count, total }) {
	document.querySelector('[data-challenge-payout-modal]')?._dispose?.();

	const prizeWord = count === 1 ? 'prize' : 'prizes';
	const credits = Number(total || 0).toLocaleString();
	const confirmText = `Pay ${count} unpaid ${prizeWord} (${credits} credits) from the admin account? Each recipient gets a congratulatory tip notification.`;

	const dialog = document.createElement('dialog');
	dialog.className = 'app-dialog challenge-payout-dialog';
	dialog.setAttribute('data-challenge-payout-modal', '');
	dialog.setAttribute('aria-labelledby', 'challenge-payout-modal-title');
	dialog.innerHTML = `<header class="app-dialog__header">
			<h2 id="challenge-payout-modal-title" class="app-dialog__title">Pay prizes</h2>
		</header>
		<div class="app-dialog__body" data-payout-modal-body>
			<p class="challenge-payout-modal-message" data-payout-modal-message></p>
			<div class="challenge-payout-modal-loading" data-payout-modal-loading hidden>
				<span class="challenge-payout-modal-spinner" aria-hidden="true"></span>
				<p class="challenge-payout-modal-loading-label" data-payout-modal-loading-label>Paying prizes…</p>
			</div>
			<p class="challenge-payout-modal-status" data-payout-modal-status hidden role="status"></p>
		</div>
		<footer class="app-dialog__footer" data-payout-modal-footer>
			<button type="button" class="btn-outlined" data-payout-modal-cancel>Cancel</button>
			<button type="button" class="btn-primary" data-payout-modal-confirm>Pay now</button>
			<button type="button" class="btn-primary" data-payout-modal-done hidden>Close</button>
		</footer>`;

	const dismiss = createModalDismissButton();
	dialog.querySelector('header')?.append(dismiss);

	const messageEl = dialog.querySelector('[data-payout-modal-message]');
	const loadingEl = dialog.querySelector('[data-payout-modal-loading]');
	const loadingLabelEl = dialog.querySelector('[data-payout-modal-loading-label]');
	const statusEl = dialog.querySelector('[data-payout-modal-status]');
	const cancelBtn = dialog.querySelector('[data-payout-modal-cancel]');
	const confirmBtn = dialog.querySelector('[data-payout-modal-confirm]');
	const doneBtn = dialog.querySelector('[data-payout-modal-done]');

	if (messageEl instanceof HTMLElement) messageEl.textContent = confirmText;

	/** @type {PayoutModalPhase} */
	let phase = 'confirm';
	let disposed = false;
	/** @type {((value: boolean) => void) | null} */
	let resolveConfirm = null;

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		if (resolveConfirm) {
			resolveConfirm(false);
			resolveConfirm = null;
		}
		if (dialog.open) dialog.close();
		dialog.remove();
	};
	dialog._dispose = dispose;

	const setPhase = (next, { message = '', loadingLabel = 'Paying prizes…' } = {}) => {
		phase = next;
		const isConfirm = next === 'confirm';
		const isLoading = next === 'loading';
		const isDone = next === 'success' || next === 'error';

		if (messageEl instanceof HTMLElement) {
			messageEl.hidden = !isConfirm;
			if (isConfirm && message) messageEl.textContent = message;
		}
		if (loadingEl instanceof HTMLElement) loadingEl.hidden = !isLoading;
		if (loadingLabelEl instanceof HTMLElement && isLoading) {
			loadingLabelEl.textContent = loadingLabel;
		}
		if (statusEl instanceof HTMLElement) {
			statusEl.hidden = !isDone;
			statusEl.textContent = isDone ? message : '';
			statusEl.classList.toggle('is-success', next === 'success');
			statusEl.classList.toggle('is-error', next === 'error');
		}
		if (cancelBtn instanceof HTMLElement) cancelBtn.hidden = !isConfirm;
		if (confirmBtn instanceof HTMLElement) confirmBtn.hidden = !isConfirm;
		if (doneBtn instanceof HTMLElement) doneBtn.hidden = !isDone;
		dismiss.hidden = isLoading;
		dismiss.disabled = isLoading;
		dialog.setAttribute('data-phase', next);
	};

	const close = () => dispose();

	dismiss.addEventListener('click', () => {
		if (phase === 'loading') return;
		if (phase === 'confirm' && resolveConfirm) {
			resolveConfirm(false);
			resolveConfirm = null;
		}
		dispose();
	});
	cancelBtn?.addEventListener('click', () => {
		if (resolveConfirm) {
			resolveConfirm(false);
			resolveConfirm = null;
		}
		dispose();
	});
	confirmBtn?.addEventListener('click', () => {
		if (phase !== 'confirm' || !resolveConfirm) return;
		const resolve = resolveConfirm;
		resolveConfirm = null;
		resolve(true);
	});
	doneBtn?.addEventListener('click', () => dispose());

	dialog.addEventListener('cancel', (event) => {
		if (phase === 'loading') {
			event.preventDefault();
			return;
		}
		if (phase === 'confirm' && resolveConfirm) {
			resolveConfirm(false);
			resolveConfirm = null;
		}
	});
	dialog.addEventListener('click', (event) => {
		if (event.target !== dialog || phase === 'loading') return;
		if (phase === 'confirm' && resolveConfirm) {
			resolveConfirm(false);
			resolveConfirm = null;
		}
		dispose();
	});
	dialog.addEventListener('close', () => dispose(), { once: true });

	document.body.append(dialog);
	dialog.showModal();
	setPhase('confirm');

	return {
		waitForConfirm: () =>
			new Promise((resolve) => {
				if (disposed) {
					resolve(false);
					return;
				}
				resolveConfirm = resolve;
			}),
		setLoading: (message = 'Paying prizes…') => {
			if (disposed) return;
			setPhase('loading', { loadingLabel: message });
		},
		setSuccess: (message) => {
			if (disposed) return;
			setPhase('success', { message });
		},
		setError: (message) => {
			if (disposed) return;
			setPhase('error', { message });
		},
		close
	};
}
