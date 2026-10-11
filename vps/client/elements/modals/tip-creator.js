import './tip-creator.css';
import { createModalDismissButton } from '../../shared/modalDismiss.js';
import { refreshAfterMutation } from '../../shared/creationDetailRuntime.js';

/**
 * Modal to tip credits to a creator (e.g. from creation detail page).
 * Listens for open-tip-creator-modal with detail: { userId, userName, createdImageId, viewerBalance? }.
 * Uses same API as admin user tip: POST /api/credits/tip with toUserId, amount, createdImageId, message.
 */
const html = String.raw;

const TIP_LARGE_AMOUNT_WARNING = 5.0;

class AppModalTipCreator extends HTMLElement {
	constructor() {
		super();
		this._userId = null;
		this._userName = null;
		this._createdImageId = null;
		this._viewerBalance = null;
		this._form = null;
		this._amountInput = null;
		this._errorEl = null;
		this._submitBtn = null;
		this._cancelBtn = null;
		this._recipientEl = null;
		this._balanceHintEl = null;
		this._warningEl = null;
		this._boundOpen = (e) => this.open(e.detail);
		this._boundCloseAll = () => this.close();
		this._boundDialogClose = () => {
			document.dispatchEvent(new CustomEvent('modal-closed'));
		};
	}

	connectedCallback() {
		this.setAttribute('data-modal', '');
		this.render();
		this._form = this.querySelector('[data-tip-creator-form]');
		this._amountInput = this.querySelector('#tip-creator-modal-amount');
		this._errorEl = this.querySelector('[data-tip-creator-error]');
		this._submitBtn = this.querySelector('[data-tip-creator-submit]');
		this._cancelBtn = this.querySelector('[data-tip-creator-cancel]');
		this._recipientEl = this.querySelector('[data-tip-creator-recipient]');
		this._balanceHintEl = this.querySelector('[data-tip-creator-balance-hint]');
		this._warningEl = this.querySelector('[data-tip-creator-warning]');

		const dialog = this.dialog;
		dialog?.addEventListener('click', (e) => {
			if (e.target === dialog) this.close();
		});
		dialog?.addEventListener('close', this._boundDialogClose);
		this._form?.addEventListener('submit', (e) => this.handleSubmit(e));
		this._cancelBtn?.addEventListener('click', () => this.close());
		this._submitBtn?.addEventListener('click', () => this._form?.requestSubmit());

		if (this._amountInput) {
			this._amountInput.addEventListener('input', () => this.updateStateFromAmount());
		}

		document.addEventListener('open-tip-creator-modal', this._boundOpen);
		document.addEventListener('close-all-modals', this._boundCloseAll);
	}

	disconnectedCallback() {
		document.removeEventListener('open-tip-creator-modal', this._boundOpen);
		document.removeEventListener('close-all-modals', this._boundCloseAll);
		this.dialog?.removeEventListener('close', this._boundDialogClose);
	}

	/** @returns {HTMLDialogElement | null} */
	get dialog() {
		const el = this.querySelector('dialog[data-tip-creator-modal]');
		return el?.tagName === 'DIALOG' ? /** @type {HTMLDialogElement} */ (el) : null;
	}

	render() {
		this.innerHTML = html`
			<dialog class="app-dialog tip-creator-dialog" data-tip-creator-modal aria-labelledby="tip-creator-title">
				<header class="app-dialog__header">
					<h2 id="tip-creator-title" class="app-dialog__title">Tip</h2>
				</header>
				<div class="app-dialog__body">
					<p class="tip-creator-recipient" data-tip-creator-recipient></p>
					<form class="tip-creator-form" data-tip-creator-form>
						<input type="hidden" name="toUserId" value="" />
						<input type="hidden" name="createdImageId" value="" />
						<div class="tip-creator-label">
							<label for="tip-creator-modal-amount">Amount (credits)</label>
							<input id="tip-creator-modal-amount" type="number" name="amount" min="0.1" step="0.1"
								inputmode="decimal" required placeholder="0.0" />
						</div>
						<p class="tip-creator-balance-hint" data-tip-creator-balance-hint></p>
						<div class="tip-creator-label">
							<label for="tip-creator-modal-message">Message (optional)</label>
							<textarea id="tip-creator-modal-message" name="message" rows="2" maxlength="500"
								class="tip-creator-message" placeholder="Optional note to the creator"></textarea>
						</div>
						<p class="tip-creator-warning" data-tip-creator-warning hidden></p>
						<div class="alert error tip-creator-error" data-tip-creator-error hidden></div>
					</form>
				</div>
				<footer class="app-dialog__footer">
					<button type="button" class="btn-secondary" data-tip-creator-cancel>Cancel</button>
					<button type="button" class="btn-primary tip-creator-submit" data-tip-creator-submit>
						<span class="tip-creator-submit-label">Tip</span>
						<span class="tip-creator-spinner" aria-hidden="true"></span>
					</button>
				</footer>
			</dialog>
		`;
		const dialog = this.dialog;
		const header = dialog?.querySelector('header');
		if (dialog && header) {
			const dismiss = createModalDismissButton({ attrs: { 'data-tip-creator-close': '' } });
			dismiss.addEventListener('click', () => this.close());
			header.append(dismiss);
		}
	}

	open(detail) {
		const userId = detail?.userId != null ? Number(detail.userId) : null;
		const userName = typeof detail?.userName === 'string' ? detail.userName.trim() : '';
		const createdImageId = detail?.createdImageId != null ? Number(detail.createdImageId) : null;
		const viewerBalanceRaw = detail?.viewerBalance;
		let viewerBalance = null;
		if (typeof viewerBalanceRaw === 'number' && Number.isFinite(viewerBalanceRaw)) {
			viewerBalance = viewerBalanceRaw;
		} else {
			try {
				const stored = window.localStorage?.getItem('credits-balance');
				if (stored != null) {
					const n = Number(stored);
					if (Number.isFinite(n)) viewerBalance = n;
				}
			} catch {
				// ignore
			}
		}

		if (!Number.isFinite(userId) || userId <= 0) return;

		this._userId = userId;
		this._userName = userName || 'Creator';
		this._createdImageId = Number.isFinite(createdImageId) && createdImageId > 0 ? createdImageId : null;
		this._viewerBalance = viewerBalance;

		if (this._form) {
			this._form.reset();
			this._form.elements.toUserId.value = String(userId);
			if (this._form.elements.createdImageId) {
				this._form.elements.createdImageId.value = this._createdImageId != null ? String(this._createdImageId) : '';
			}
		}
		if (this._amountInput) this._amountInput.value = '';
		if (this._errorEl) {
			this._errorEl.hidden = true;
			this._errorEl.textContent = '';
		}
		if (this._recipientEl) {
			this._recipientEl.textContent = `Send credits to ${this._userName}`;
		}

		this.updateStateFromAmount();

		const dialog = this.dialog;
		if (dialog && !dialog.open && typeof dialog.showModal === 'function') {
			dialog.showModal();
			if (this._amountInput) setTimeout(() => this._amountInput.focus(), 100);
		}
		document.dispatchEvent(new CustomEvent('modal-opened'));
	}

	close() {
		const dialog = this.dialog;
		if (dialog?.open && typeof dialog.close === 'function') {
			dialog.close();
		}
	}

	updateStateFromAmount() {
		if (!this._amountInput || !this._submitBtn) return;
		const raw = this._amountInput.value;
		const amount = Number(raw);
		let canSubmit = Number.isFinite(amount) && amount > 0;

		if (this._balanceHintEl) {
			let hintText = '';

			if (this._viewerBalance != null && Number.isFinite(this._viewerBalance)) {
				const balance = this._viewerBalance;

				if (!Number.isFinite(amount) || amount <= 0) {
					hintText = `You have ${balance.toFixed(1)} credits.`;
				} else {
					const remaining = balance - amount;
					if (remaining >= 0) {
						hintText = `You'll have ${remaining.toFixed(1)} credits left.`;
					} else {
						hintText = 'This exceeds your available credits.';
						canSubmit = false;
					}
				}
			}

			this._balanceHintEl.textContent = hintText;
		}

		if (this._warningEl) {
			if (Number.isFinite(amount) && amount >= TIP_LARGE_AMOUNT_WARNING) {
				this._warningEl.hidden = false;
				this._warningEl.textContent = 'This is a large tip. Please confirm you\'re sure.';
			} else {
				this._warningEl.hidden = true;
				this._warningEl.textContent = '';
			}
		}

		this._submitBtn.disabled = !canSubmit;
	}

	async handleSubmit(e) {
		if (e) e.preventDefault();
		if (!this._form) return;

		const amountInput = this._form.elements.amount;
		const fixedWidth = this._submitBtn?.getBoundingClientRect().width;
		if (this._submitBtn) {
			this._submitBtn.disabled = true;
			if (fixedWidth) this._submitBtn.style.width = `${fixedWidth}px`;
			this._submitBtn.classList.add('is-loading');
		}
		if (amountInput) amountInput.disabled = true;
		if (this._errorEl) {
			this._errorEl.hidden = true;
			this._errorEl.textContent = '';
		}

		const toUserId = Number(this._form.elements.toUserId.value);
		const amount = Number(this._form.elements.amount.value);
		const createdImageId = this._createdImageId != null ? Number(this._createdImageId) : null;
		const message = this._form.elements.message ? String(this._form.elements.message.value || '').trim() : '';

		try {
			const response = await fetch('/api/credits/tip', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					toUserId,
					amount,
					createdImageId,
					message
				})
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				const errMessage = data?.error || 'Failed to tip credits.';
				const messageHtml = data?.errorHtml;
				if (this._errorEl) {
					this._errorEl.hidden = false;
					if (messageHtml && typeof messageHtml === 'string') {
						this._errorEl.innerHTML = messageHtml;
					} else {
						this._errorEl.textContent = errMessage;
					}
				} else alert(errMessage);
				return;
			}

			const nextFromBalance = typeof data?.fromBalance === 'number' ? data.fromBalance : null;
			if (nextFromBalance !== null) {
				document.dispatchEvent(new CustomEvent('credits-updated', { detail: { count: nextFromBalance } }));
				try {
					window.localStorage?.setItem('credits-balance', String(nextFromBalance));
				} catch {}
			}
			document.dispatchEvent(new CustomEvent('user-updated', { detail: { userId: toUserId } }));
			this.close();
			if (createdImageId !== null) {
				await refreshAfterMutation('status-changed', { creationId: createdImageId });
			}
		} catch (err) {
			const errMessage = err?.message || 'Failed to tip credits.';
			if (this._errorEl) {
				this._errorEl.hidden = false;
				this._errorEl.textContent = errMessage;
			} else alert(errMessage);
		} finally {
			if (this._submitBtn) {
				this._submitBtn.disabled = false;
				this._submitBtn.classList.remove('is-loading');
				this._submitBtn.style.width = '';
			}
			if (amountInput) amountInput.disabled = false;
		}
	}
}

customElements.define('app-modal-tip-creator', AppModalTipCreator);
