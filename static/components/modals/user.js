const html = String.raw;

function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

class AppModalUser extends HTMLElement {
	constructor() {
		super();
		this._currentUser = null;
		this._viewerUserId = null;
		this._boundEscape = (e) => {
			if (e.key === 'Escape' && this._overlay?.classList.contains('open')) this.close();
		};
	}

	connectedCallback() {
		this.render();
		this._overlay = this.querySelector('[data-user-modal-overlay]');
		this._details = this.querySelector('[data-user-modal-details]');
		this._form = this.querySelector('[data-user-tip-form]');
		this._error = this.querySelector('[data-user-tip-error]');
		this._overlay?.addEventListener('click', (e) => {
			if (e.target?.dataset?.userClose !== undefined || e.target === this._overlay) this.close();
		});
		document.addEventListener('keydown', this._boundEscape);
		this._form?.addEventListener('submit', (e) => this.handleSubmit(e));
		this.loadViewerUser();
	}

	disconnectedCallback() {
		document.removeEventListener('keydown', this._boundEscape);
	}

	async loadViewerUser() {
		try {
			const response = await fetch('/api/profile', { credentials: 'include' });
			if (!response.ok) return;
			const data = await response.json();
			this._viewerUserId = Number(data?.id) || null;
		} catch {
			// ignore
		}
	}

	render() {
		this.innerHTML = html`
			<div class="publish-modal-overlay" data-user-modal-overlay role="dialog" aria-modal="true"
				aria-labelledby="user-modal-title">
				<div class="publish-modal user-modal">
					<header class="publish-modal-header">
						<h3 id="user-modal-title" class="user-modal-title">User</h3>
						<button type="button" class="publish-modal-close" data-user-close aria-label="Close">✕</button>
					</header>
					<div class="publish-modal-body user-modal-body">
						<div class="user-modal-details" data-user-modal-details></div>
						<form class="user-tip-form" data-user-tip-form>
							<input type="hidden" name="toUserId" value="" />
							<label class="user-tip-label">
								Tip credits
								<div class="user-tip-row">
									<input type="number" name="amount" min="0.1" step="0.1" inputmode="decimal" required />
									<button type="submit" class="btn-primary user-tip-button">
										<span class="user-tip-button-label">Tip</span>
										<span class="user-tip-spinner" aria-hidden="true"></span>
									</button>
								</div>
							</label>
							<div class="alert error user-tip-error" data-user-tip-error hidden></div>
						</form>
					</div>
				</div>
			</div>
		`;
	}

	open(user) {
		this._currentUser = user;
		const title = this.querySelector('#user-modal-title');
		if (title) title.textContent = user?.email || 'User';
		this.renderDetails(user);
		if (this._form) {
			this._form.reset();
			this._form.elements.toUserId.value = String(user?.id ?? '');
		}
		if (this._error) {
			this._error.hidden = true;
			this._error.textContent = '';
		}
		this._overlay?.classList.add('open');
	}

	close() {
		this._overlay?.classList.remove('open');
		this._currentUser = null;
		if (this._error) {
			this._error.hidden = true;
			this._error.textContent = '';
		}
	}

	renderDetails(user) {
		if (!this._details) return;
		const creditsValue = typeof user?.credits === 'number' ? user.credits : 0;
		const profileHref = user?.id ? `/user/${user.id}` : null;
		this._details.innerHTML = `
			<div class="field">
				<label>User ID</label>
				<div class="value">${escapeHtml(String(user?.id ?? ''))}</div>
			</div>
			<div class="field">
				<label>Email</label>
				<div class="value">${escapeHtml(String(user?.email ?? ''))}</div>
			</div>
			<div class="field">
				<label>Role</label>
				<div class="value">${escapeHtml(String(user?.role ?? ''))}</div>
			</div>
			<div class="field">
				<label>Credits</label>
				<div class="value" data-user-modal-credits>${escapeHtml(creditsValue.toFixed(1))}</div>
			</div>
			${profileHref ? `
				<div class="field">
					<label>Profile</label>
					<div class="value"><a class="user-link" href="${escapeHtml(profileHref)}">View profile</a></div>
				</div>
			` : ''}
		`;
	}

	async handleSubmit(e) {
		e.preventDefault();
		if (!this._currentUser || !this._form) return;

		const submitButton = this._form.querySelector('button[type="submit"]');
		const amountInput = this._form.elements.amount;
		const fixedWidth = submitButton ? submitButton.getBoundingClientRect().width : null;
		if (submitButton) {
			submitButton.disabled = true;
			if (fixedWidth) submitButton.style.width = `${fixedWidth}px`;
			submitButton.classList.add('is-loading');
		}
		if (amountInput) amountInput.disabled = true;
		if (this._error) {
			this._error.hidden = true;
			this._error.textContent = '';
		}

		const toUserId = Number(this._form.elements.toUserId.value);
		const amount = Number(this._form.elements.amount.value);

		try {
			const response = await fetch('/api/credits/tip', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ toUserId, amount })
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				const message = data?.error || 'Failed to tip credits.';
				if (this._error) {
					this._error.hidden = false;
					this._error.textContent = message;
				} else alert(message);
				return;
			}

			const nextToBalance = typeof data?.toBalance === 'number' ? data.toBalance : null;
			const nextFromBalance = typeof data?.fromBalance === 'number' ? data.fromBalance : null;

			if (nextToBalance !== null) {
				this._currentUser.credits = nextToBalance;
				const creditsEl = this.querySelector('[data-user-modal-credits]');
				if (creditsEl) creditsEl.textContent = nextToBalance.toFixed(1);
			}

			const recipientCard = document.querySelector(`.user-card[data-user-id="${toUserId}"]`);
			if (recipientCard && nextToBalance !== null) {
				const creditsSpan = recipientCard.querySelector('.user-credits');
				if (creditsSpan) creditsSpan.textContent = `${nextToBalance.toFixed(1)} credits`;
			}

			if (nextFromBalance !== null) {
				document.dispatchEvent(new CustomEvent('credits-updated', { detail: { count: nextFromBalance } }));
				try {
					window.localStorage?.setItem('credits-balance', String(nextFromBalance));
				} catch { }
				if (this._viewerUserId) {
					const senderCard = document.querySelector(`.user-card[data-user-id="${this._viewerUserId}"]`);
					if (senderCard) {
						const creditsSpan = senderCard.querySelector('.user-credits');
						if (creditsSpan) creditsSpan.textContent = `${nextFromBalance.toFixed(1)} credits`;
					}
				}
			}

			this._form.reset();
			this._form.elements.toUserId.value = String(toUserId);
			document.dispatchEvent(new CustomEvent('user-updated', { detail: { userId: toUserId } }));
		} catch (err) {
			const message = err?.message || 'Failed to tip credits.';
			if (this._error) {
				this._error.hidden = false;
				this._error.textContent = message;
			} else alert(message);
		} finally {
			if (submitButton) {
				submitButton.disabled = false;
				submitButton.classList.remove('is-loading');
				submitButton.style.width = '';
			}
			if (amountInput) amountInput.disabled = false;
		}
	}
}

customElements.define('app-modal-user', AppModalUser);
