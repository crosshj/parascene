const html = String.raw;

class AppCredits extends HTMLElement {
	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
		this._isOpen = false;
		this.creditsCount = 0;
		this.lastClaimDate = null;
		this.handleEscape = this.handleEscape.bind(this);
		this.handleOpenEvent = this.handleOpenEvent.bind(this);
		this.handleCloseEvent = this.handleCloseEvent.bind(this);
		this.handleClaimCredits = this.handleClaimCredits.bind(this);
	}

	connectedCallback() {
		this.render();
		this.setupEventListeners();
		this.refreshCredits();
	}

	disconnectedCallback() {
		document.removeEventListener('keydown', this.handleEscape);
		document.removeEventListener('open-credits', this.handleOpenEvent);
		document.removeEventListener('close-credits', this.handleCloseEvent);
	}

	setupEventListeners() {
		document.addEventListener('keydown', this.handleEscape);
		document.addEventListener('open-credits', this.handleOpenEvent);
		document.addEventListener('close-credits', this.handleCloseEvent);

		const overlay = this.shadowRoot.querySelector('.credits-overlay');
		const closeButton = this.shadowRoot.querySelector('.credits-close');
		const claimButton = this.shadowRoot.querySelector('.credits-claim-button');
		const linkButtons = this.shadowRoot.querySelectorAll('.credits-link-button');

		if (overlay) {
			overlay.addEventListener('click', (e) => {
				if (e.target === overlay) {
					this.close();
				}
			});
		}

		if (closeButton) {
			closeButton.addEventListener('click', () => {
				this.close();
			});
		}

		if (claimButton) {
			claimButton.addEventListener('click', this.handleClaimCredits);
		}

		if (linkButtons.length > 0) {
			linkButtons.forEach((link) => {
				link.addEventListener('click', (e) => {
					e.preventDefault();
					const href = link.getAttribute('href');
					if (!href) return;
					this.close();
					if (href.startsWith('/servers')) {
						window.location.assign(href);
						return;
					}
					window.location.assign(href);
				});
			});
		}
	}

	handleOpenEvent() {
		this.open();
	}

	handleCloseEvent() {
		this.close();
	}

	handleEscape(e) {
		if (e.key === 'Escape' && this.isOpen()) {
			this.close();
		}
	}

	isOpen() {
		return this._isOpen;
	}

	open() {
		if (this._isOpen) return;
		this._isOpen = true;
		const overlay = this.shadowRoot.querySelector('.credits-overlay');
		if (overlay) {
			overlay.classList.add('open');
		}
		document.dispatchEvent(new CustomEvent('close-notifications'));
		document.dispatchEvent(new CustomEvent('modal-opened'));
		this.refreshCredits();
	}

	close() {
		if (!this._isOpen) return;
		this._isOpen = false;
		const overlay = this.shadowRoot.querySelector('.credits-overlay');
		if (overlay) {
			overlay.classList.remove('open');
		}
		document.dispatchEvent(new CustomEvent('modal-closed'));
	}

	async refreshCredits() {
		try {
			// First, get current user to check if user changed
			let currentUserEmail = null;
			try {
				const profileResponse = await fetch('/api/profile', { credentials: 'include' });
				if (profileResponse.ok) {
					const profile = await profileResponse.json();
					currentUserEmail = profile?.email || null;
				}
			} catch {
				// Ignore profile fetch errors
			}

			// If no signed-in user, clear cache
			if (!currentUserEmail) {
				this.clearStoredCredits();
				this.clearStoredUserEmail();
				this.creditsCount = 0;
				this.updateCreditsUI();
				this.updateClaimUI();
				return;
			}

			// Check if user changed - if so, clear cache
			const cachedUserEmail = this.readStoredUserEmail();
			if (cachedUserEmail && currentUserEmail !== cachedUserEmail) {
				// User changed - clear cache
				this.clearStoredCredits();
				this.clearStoredUserEmail();
			}

			const response = await fetch('/api/credits', { credentials: 'include' });
			if (!response.ok) {
				// If unauthorized or any error, clear cache
				if (response.status === 401 || !currentUserEmail) {
					this.clearStoredCredits();
					this.clearStoredUserEmail();
				}
				this.creditsCount = 0;
				this.updateCreditsUI();
				this.updateClaimUI();
				return;
			}
			const data = await response.json();
			this.creditsCount = this.normalizeCredits(data?.balance ?? 0);
			this.lastClaimDate = data?.lastClaimDate || null;
			// Cache in localStorage with user email
			if (currentUserEmail) {
				this.writeStoredCredits(this.creditsCount);
				this.writeStoredUserEmail(currentUserEmail);
			}
			this.updateCreditsUI();
			this.updateClaimUI();
		} catch {
			// Fallback to cached value only if user matches
			const cachedUserEmail = this.readStoredUserEmail();
			let currentUserEmail = null;
			try {
				const profileResponse = await fetch('/api/profile', { credentials: 'include' });
				if (profileResponse.ok) {
					const profile = await profileResponse.json();
					currentUserEmail = profile?.email || null;
				}
			} catch {
				// Ignore profile fetch errors
			}

			// If no signed-in user, clear cache
			if (!currentUserEmail) {
				this.clearStoredCredits();
				this.clearStoredUserEmail();
				this.creditsCount = 0;
				this.updateCreditsUI();
				this.updateClaimUI();
				return;
			}

			// Only use cached value if user matches
			if (cachedUserEmail && currentUserEmail === cachedUserEmail) {
				const storedCredits = this.readStoredCredits();
				if (storedCredits !== null) {
					this.creditsCount = storedCredits;
					this.updateCreditsUI();
					this.updateClaimUI();
					return;
				}
			} else {
				// User changed or no cache - clear it
				this.clearStoredCredits();
				this.clearStoredUserEmail();
			}

			this.creditsCount = 0;
			this.updateCreditsUI();
			this.updateClaimUI();
		}
	}

	async handleClaimCredits() {
		if (this.isClaimedToday()) return;

		try {
			const response = await fetch('/api/credits/claim', {
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (!response.ok) {
				const error = await response.json();
				console.error('Failed to claim credits:', error);
				return;
			}

			const data = await response.json();
			if (data.success) {
				this.creditsCount = this.normalizeCredits(data.balance);
				this.writeStoredCredits(this.creditsCount);
				// Refresh to get updated lastClaimDate
				await this.refreshCredits();
				this.updateCreditsUI();
				this.updateClaimUI();
				document.dispatchEvent(new CustomEvent('credits-updated', {
					detail: { count: this.creditsCount }
				}));
				document.dispatchEvent(new CustomEvent('credits-claim-status', {
					detail: { canClaim: false }
				}));
			}
		} catch (error) {
			console.error('Error claiming credits:', error);
		}
	}

	updateCreditsUI() {
		const balanceValue = this.shadowRoot.querySelector('.credits-balance-value');
		if (balanceValue) {
			balanceValue.textContent = this.formatCredits(this.creditsCount);
		}
	}

	updateClaimUI() {
		const claimButton = this.shadowRoot.querySelector('.credits-claim-button');
		const claimNote = this.shadowRoot.querySelector('.credits-claim-note');
		const claimed = this.isClaimedToday();
		if (claimButton) {
			claimButton.disabled = claimed;
		}
		if (claimNote) {
			claimNote.textContent = claimed ? 'Come back tomorrow for more credits.' : '';
		}
		document.dispatchEvent(new CustomEvent('credits-claim-status', {
			detail: { canClaim: !claimed }
		}));
	}

	isClaimedToday() {
		if (!this.lastClaimDate) return false;
		const now = new Date();
		const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
		const lastClaimDate = new Date(this.lastClaimDate);
		const lastClaimUTC = new Date(Date.UTC(lastClaimDate.getUTCFullYear(), lastClaimDate.getUTCMonth(), lastClaimDate.getUTCDate()));
		return lastClaimUTC.getTime() >= todayUTC.getTime();
	}

	getTodayKey() {
		return new Date().toISOString().slice(0, 10);
	}

	normalizeCredits(value) {
		const count = Number(value);
		if (!Number.isFinite(count)) return 0;
		return Math.max(0, Math.round(count * 10) / 10);
	}

	formatCredits(value) {
		const count = this.normalizeCredits(value);
		// Show the actual decimal value (e.g., "101.5" instead of "101+")
		// If it's a whole number, show without decimal places
		const wholePart = Math.floor(count);
		const decimalPart = count - wholePart;
		if (decimalPart > 0) {
			// Show one decimal place
			return count.toFixed(1);
		}
		return String(wholePart);
	}

	readStoredCredits() {
		try {
			const stored = window.localStorage?.getItem('credits-balance');
			if (stored == null) return null;
			return this.normalizeCredits(stored);
		} catch {
			return null;
		}
	}

	writeStoredCredits(value) {
		try {
			window.localStorage?.setItem('credits-balance', String(this.normalizeCredits(value)));
		} catch {
			// ignore storage errors
		}
	}

	readStoredClaimDate() {
		try {
			return window.localStorage?.getItem('credits-last-claim');
		} catch {
			return null;
		}
	}

	writeStoredClaimDate(value) {
		try {
			window.localStorage?.setItem('credits-last-claim', value);
		} catch {
			// ignore storage errors
		}
	}

	readStoredUserEmail() {
		try {
			return window.localStorage?.getItem('credits-user-email');
		} catch {
			return null;
		}
	}

	writeStoredUserEmail(email) {
		try {
			window.localStorage?.setItem('credits-user-email', email);
		} catch {
			// ignore storage errors
		}
	}

	clearStoredCredits() {
		try {
			window.localStorage?.removeItem('credits-balance');
		} catch {
			// ignore storage errors
		}
	}

	clearStoredUserEmail() {
		try {
			window.localStorage?.removeItem('credits-user-email');
		} catch {
			// ignore storage errors
		}
	}

	render() {
		this.shadowRoot.innerHTML = html`
      <style>
        :host {
          display: block;
        }
        .credits-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 99999;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s, visibility 0.2s;
        }
        .credits-overlay.open {
          opacity: 1;
          visibility: visible;
        }
        .credits-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          box-shadow: var(--shadow);
          max-width: 560px;
          width: 92%;
          max-height: 90vh;
          overflow-y: auto;
          transform: scale(0.95);
          transition: transform 0.2s;
        }
        .credits-overlay.open .credits-modal {
          transform: scale(1);
        }
        .credits-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 20px;
          border-bottom: 1px solid var(--border);
        }
        .credits-header h2 {
          margin: 0;
          font-size: 1.5rem;
        }
        .credits-close {
          background: transparent;
          border: none;
          color: var(--text);
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          transition: background-color 0.2s;
        }
        .credits-close:hover {
          background: var(--surface-strong);
        }
        .credits-close-icon {
          width: 24px;
          height: 24px;
        }
        .credits-body {
          padding: 20px;
          color: var(--text);
        }
        .credits-balance {
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--surface-strong);
          font-weight: 600;
          margin-bottom: 18px;
        }
        .credits-balance-value {
          font-weight: 700;
        }
        .credits-body p {
          margin: 0 0 12px;
          color: var(--text);
        }
        .credits-section {
          margin-top: 3em;
        }
        .credits-section h3 {
          margin: 0 0 8px;
          font-size: 1rem;
        }
        .credits-list {
          margin: 0;
          padding-left: 18px;
          color: var(--text);
        }
        .credits-list li {
          margin: 6px 0;
        }
        .credits-action-row {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 10px;
        }
        .credits-action-button {
          padding: 8px 14px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--accent);
          color: var(--accent-text);
          cursor: pointer;
          font-weight: 600;
          width: fit-content;
        }
        .credits-action-button:disabled {
          background: var(--surface-strong);
          color: var(--text-muted);
          cursor: not-allowed;
          border-color: var(--border);
        }
        .credits-link-button {
          display: inline-flex;
          align-items: center;
          padding: 8px 14px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--surface-strong);
          color: var(--text);
          text-decoration: none;
          font-weight: 600;
          width: fit-content;
        }
        .credits-link-button .icon {
          width: 16px;
          height: 16px;
          margin-right: 8px;
          flex-shrink: 0;
        }
        .credits-link-button:hover {
          border-color: var(--accent);
          background: var(--surface);
        }
        .credits-claim-note {
          color: var(--text-muted);
          font-size: 0.95rem;
        }
        .credits-note {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--surface-strong);
          color: var(--text-muted);
          font-size: 0.95rem;
        }
      </style>
      <div class="credits-overlay">
        <div class="credits-modal">
          <div class="credits-header">
            <div></div>
            <button class="credits-close" aria-label="Close">
              <svg class="credits-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="credits-body">
            <div class="credits-balance">
              Available credits: <span class="credits-balance-value">0.0</span>
            </div>

            <div class="credits-section">
              <h3>Claim daily free credits</h3>
              <p>Claim 10 credits once per day.</p>
              <div class="credits-action-row">
                <button class="credits-action-button credits-claim-button" type="button">Claim 10 credits</button>
                <span class="credits-claim-note">Come back tomorrow for more credits.</span>
              </div>
            </div>

            <div class="credits-section">
              <h3>Boost a server or participate in competitions</h3>
              <p>Boosting and competitions are the fastest ways to earn more credits.</p>
              <a class="credits-link-button" href="/servers">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"></path>
                </svg>
                Boost and Compete
              </a>
            </div>

            <div class="credits-section">
              <h3>Run a server</h3>
              <p>Run a server and earn credits for supporting the community.</p>
              <a class="credits-link-button" href="/servers/help">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9"></circle>
                  <path d="M12 16h.01"></path>
                  <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4"></path>
                </svg>
                Learn More
              </a>
            </div>
          </div>
        </div>
      </div>
    `;
	}
}

customElements.define('app-credits', AppCredits);
