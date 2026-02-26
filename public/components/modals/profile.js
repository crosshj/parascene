import { formatDate } from '../../shared/datetime.js';
import { fetchJsonWithStatusDeduped } from '../../shared/api.js';
import { buildProfilePath } from '../../shared/profileLinks.js';
import { helpIcon } from '../../icons/svg-strings.js';
import {
	getNsfwContentEnabled,
	setNsfwContentEnabled,
	getNsfwObscure,
	setNsfwObscure,
	applyNsfwPreference,
	NSFW_VIEW_BODY_CLASS
} from '../../shared/nsfwView.js';

const html = String.raw;

class AppModalProfile extends HTMLElement {
	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
		this._isOpen = false;
		this.profileLoading = false;
		this.profileLoadedAt = 0;
		this.profileData = null;
		this.handleEscape = this.handleEscape.bind(this);
		this.handleOpenEvent = this.handleOpenEvent.bind(this);
		this.handleCloseEvent = this.handleCloseEvent.bind(this);
		this.handleCloseAllModals = this.handleCloseAllModals.bind(this);
	}

	connectedCallback() {
		this.setAttribute('data-modal', '');
		this.render();
		this.setupEventListeners();
		this.prefetchProfile();
	}

	disconnectedCallback() {
		document.removeEventListener('keydown', this.handleEscape);
		document.removeEventListener('open-profile', this.handleOpenEvent);
		document.removeEventListener('close-profile', this.handleCloseEvent);
		document.removeEventListener('close-all-modals', this.handleCloseAllModals);
	}

	setupEventListeners() {
		document.addEventListener('keydown', this.handleEscape);
		document.addEventListener('open-profile', this.handleOpenEvent);
		document.addEventListener('close-profile', this.handleCloseEvent);
		document.addEventListener('close-all-modals', this.handleCloseAllModals);

		const overlay = this.shadowRoot.querySelector('.profile-overlay');
		const closeButton = this.shadowRoot.querySelector('.profile-close');
		const logoutForm = this.shadowRoot.querySelector('form[action="/logout"]');

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

		if (logoutForm) {
			logoutForm.addEventListener('submit', (e) => {
				// Clear localStorage before submitting logout
				this.clearCreditsStorage();
			});
		}

		this.setupNsfwToggles();
	}

	setupNsfwToggles() {
		const enableCheckbox = this.shadowRoot.querySelector('[data-nsfw-enable]');
		const obscureWrap = this.shadowRoot.querySelector('[data-nsfw-obscure-wrap]');
		const obscureCheckbox = this.shadowRoot.querySelector('[data-nsfw-obscure]');
		if (!enableCheckbox || !obscureWrap || !obscureCheckbox) return;

		const syncObscureVisibility = () => {
			const enableOn = enableCheckbox.checked === true;
			if (enableOn) {
				obscureWrap.removeAttribute('hidden');
			} else {
				obscureWrap.setAttribute('hidden', '');
			}
		};
		const syncFromProfileAndStorage = () => {
			const enableFromApi = this.profileData?.enableNsfw === true;
			enableCheckbox.checked = enableFromApi ?? getNsfwContentEnabled();
			const showingUnobscured = !getNsfwObscure() || document.body.classList.contains(NSFW_VIEW_BODY_CLASS);
			obscureCheckbox.checked = showingUnobscured;
			syncObscureVisibility();
		};

		syncFromProfileAndStorage();

		enableCheckbox.addEventListener('change', async () => {
			const enabled = enableCheckbox.checked;
			syncObscureVisibility();
			try {
				const res = await fetchJsonWithStatusDeduped('/api/profile', {
					method: 'PATCH',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ enableNsfw: enabled })
				}, { windowMs: 0 });
				if (res?.ok) {
					if (this.profileData) this.profileData.enableNsfw = enabled;
					setNsfwContentEnabled(enabled);
					applyNsfwPreference();
					document.dispatchEvent(new CustomEvent('nsfw-preference-changed'));
				} else {
					enableCheckbox.checked = !enabled;
					syncObscureVisibility();
				}
			} catch {
				enableCheckbox.checked = !enabled;
				syncObscureVisibility();
			}
		});

		obscureCheckbox.addEventListener('change', () => {
			setNsfwObscure(!obscureCheckbox.checked);
			applyNsfwPreference();
		});
	}

	/** Sync NSFW checkbox state from profile (API) and localStorage when modal opens or profile loads. */
	syncNsfwTogglesFromStorage() {
		const enableCheckbox = this.shadowRoot.querySelector('[data-nsfw-enable]');
		const obscureWrap = this.shadowRoot.querySelector('[data-nsfw-obscure-wrap]');
		const obscureCheckbox = this.shadowRoot.querySelector('[data-nsfw-obscure]');
		if (!enableCheckbox || !obscureWrap || !obscureCheckbox) return;
		enableCheckbox.checked = this.profileData?.enableNsfw === true || getNsfwContentEnabled();
		const showingUnobscured = !getNsfwObscure() || document.body.classList.contains(NSFW_VIEW_BODY_CLASS);
		obscureCheckbox.checked = showingUnobscured;
		if (!enableCheckbox.checked) {
			obscureWrap.setAttribute('hidden', '');
		} else {
			obscureWrap.removeAttribute('hidden');
		}
	}

	handleOpenEvent() {
		this.open();
	}

	handleCloseEvent() {
		this.close();
	}

	handleCloseAllModals() {
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
		const overlay = this.shadowRoot.querySelector('.profile-overlay');
		if (overlay) {
			overlay.classList.add('open');
			this.loadProfile({ silent: true });
		}
		this.syncNsfwTogglesFromStorage();
		// Dispatch event to close notifications if open
		document.dispatchEvent(new CustomEvent('close-notifications'));
		document.dispatchEvent(new CustomEvent('modal-opened'));
	}

	close() {
		if (!this._isOpen) return;
		this._isOpen = false;
		const overlay = this.shadowRoot.querySelector('.profile-overlay');
		if (overlay) {
			overlay.classList.remove('open');
		}
		document.dispatchEvent(new CustomEvent('modal-closed'));
	}

	async loadProfile({ silent = true, force = false } = {}) {
		const content = this.shadowRoot.querySelector('.profile-content');
		if (!content) return;

		if (this.profileLoading) return;
		const now = Date.now();
		if (!force && now - this.profileLoadedAt < 30000) return;

		try {
			this.profileLoading = true;
			const result = await fetchJsonWithStatusDeduped('/api/profile', {
				credentials: 'include'
			}, { windowMs: 2000 });
			if (!result.ok) {
				if (result.status === 401) {
					if (!this.profileData) {
						content.innerHTML = html`<p style="color: var(--text-muted);">Please log in to view your profile.</p>`;
					}
					return;
				}
				throw new Error('Failed to load profile');
			}

			const user = result.data;
			const nextKey = user
				? `${user.email || ''}|${user.role || ''}|${user.created_at || ''}`
				: '';
			const currentKey = this.profileData
				? `${this.profileData.email || ''}|${this.profileData.role || ''}|${this.profileData.created_at || ''}`
				: '';

			if (nextKey !== currentKey) {
				this.profileData = user;
				this.displayProfile(user);
			}
			this.profileLoadedAt = Date.now();
			// Keep localStorage in sync with server so publish modal and others get correct default
			if (user) setNsfwContentEnabled(user.enableNsfw === true);
			this.syncNsfwTogglesFromStorage();
		} catch (error) {
			// console.error('Error loading profile:', error);
			if (!silent && !this.profileData) {
				content.innerHTML = html`<p style="color: var(--text-muted);">Failed to load profile information.</p>`;
			}
		} finally {
			this.profileLoading = false;
		}
	}

	displayProfile(user) {
		const content = this.shadowRoot.querySelector('.profile-content');
		const fullProfileLink = this.shadowRoot.querySelector('[data-full-profile-link]');
		if (!content) return;

		if (fullProfileLink) {
			const profileHref = buildProfilePath({
				userName: user?.profile?.user_name,
				userId: user?.id
			});
			fullProfileLink.setAttribute('href', profileHref || '/user');
		}

		const roleLabels = {
			consumer: 'Consumer',
			creator: 'Creator',
			provider: 'Provider',
			admin: 'Administrator'
		};

		const escapeHtml = (text) => {
			const div = document.createElement('div');
			div.textContent = text;
			return div.innerHTML;
		};

		content.innerHTML = html`
	<div class="field">
		<label>Email</label>
		<div class="value">${escapeHtml(user.email)}</div>
	</div>
	<div class="field">
		<label>Role</label>
		<div class="value">${escapeHtml(roleLabels[user.role] || user.role)}</div>
	</div>
	<div class="field">
		<label>Member Since</label>
		<div class="value">${formatDate(user.created_at) || 'N/A'}</div>
	</div>
    `;
	}

	render() {
		this.shadowRoot.innerHTML = html`
      <style>
        :host {
          display: block;
        }
        .profile-overlay {
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
        .profile-overlay.open {
          opacity: 1;
          visibility: visible;
        }
        .profile-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          box-shadow: var(--shadow);
          max-width: 500px;
          width: 90%;
          max-height: 90vh;
          overflow-y: auto;
          transform: scale(0.95);
          transition: transform 0.2s;
        }
        .profile-overlay.open .profile-modal {
          transform: scale(1);
        }
        .profile-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 20px;
          border-bottom: 1px solid var(--border);
        }
        .profile-header h2 {
          margin: 0;
          font-size: 1.5rem;
        }
        .profile-close {
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
        .profile-close:hover {
          background: var(--surface-strong);
        }
        .profile-close-icon {
          width: 24px;
          height: 24px;
        }
        .profile-body {
          padding: 20px;
        }
        .profile-actions {
          display: flex;
          justify-content: flex-end;
          padding: 0 20px 20px;
          gap: 10px;
          flex-wrap: wrap;
        }
        .profile-actions form {
          margin: 0;
        }
        /* Mirror global .btn-secondary (shadow DOM does not inherit global.css) */
        .btn-secondary,
        a.btn-secondary {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          text-decoration: none;
          font-size: 0.95rem;
          transition: background-color 0.2s, border-color 0.2s;
          box-shadow: var(--shadow);
          cursor: pointer;
          font: inherit;
          border-radius: 6px;
          -webkit-appearance: none;
          appearance: none;
          box-sizing: border-box;
          line-height: 1;
        }
        @supports (corner-shape: squircle) {
          .btn-secondary,
          a.btn-secondary {
            border-radius: 14px;
            corner-shape: squircle;
          }
        }
        .btn-secondary:hover:not(:disabled),
        a.btn-secondary:hover {
          background: var(--surface-strong);
          border-color: var(--accent);
        }
        .btn-secondary.is-logout {
          background: var(--surface-strong);
        }
        .btn-secondary.is-logout:hover {
          border-color: var(--accent);
          background: var(--surface);
        }
        .btn-secondary .profile-action-icon,
        a.btn-secondary .profile-action-icon {
          width: 18px;
          height: 18px;
          margin-right: 8px;
          flex-shrink: 0;
        }
        .field {
          margin: 12px 0;
        }
        .field:first-child {
          margin-top: 0;
        }
        .field:last-child {
          margin-bottom: 0;
        }
        .field label,
        .field .label {
          display: block;
          font-weight: 600;
          margin-bottom: 6px;
          color: var(--text-muted);
          font-size: 0.9rem;
        }
        .field .value {
          font-size: 1rem;
          color: var(--text);
        }
        .profile-nsfw-toggles {
          margin-top: 20px;
          padding-top: 16px;
          border-top: 1px solid var(--border);
        }
        .profile-nsfw-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: 10px 0;
        }
        .profile-nsfw-row:first-child {
          margin-top: 0;
        }
        .profile-nsfw-row label {
          margin: 0;
          font-weight: 600;
          color: var(--text-muted);
          font-size: 0.9rem;
        }
        .profile-nsfw-row input[type="checkbox"] {
          width: 18px;
          height: 18px;
          cursor: pointer;
          accent-color: var(--accent);
        }
        [data-nsfw-obscure-wrap][hidden] {
          display: none !important;
        }
      </style>
      <div class="profile-overlay">
        <div class="profile-modal">
          <div class="profile-header">
            <h2>Profile</h2>
            <button class="profile-close" aria-label="Close">
              <svg class="profile-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="profile-body">
            <div class="profile-content"></div>
            <div class="profile-nsfw-toggles">
              <div class="profile-nsfw-row">
                <label for="profile-nsfw-enable">Enable NSFW Content</label>
                <input type="checkbox" id="profile-nsfw-enable" data-nsfw-enable aria-describedby="profile-nsfw-enable-desc" />
              </div>
              <div class="profile-nsfw-row" data-nsfw-obscure-wrap hidden>
                <label for="profile-nsfw-obscure">Show NSFW Unobscured</label>
                <input type="checkbox" id="profile-nsfw-obscure" data-nsfw-obscure aria-describedby="profile-nsfw-obscure-desc" />
              </div>
            </div>
          </div>
          <div class="profile-actions">
            <a class="btn-secondary" href="/help">${helpIcon('profile-action-icon')} Help</a>
            <a class="btn-secondary" href="/user" data-full-profile-link>View Full Profile</a>
            <form action="/logout" method="post">
              <button type="submit" class="btn-secondary is-logout">Logout</button>
            </form>
          </div>
        </div>
      </div>
    `;
	}

	prefetchProfile() {
		const schedule = window.requestIdleCallback
			? window.requestIdleCallback.bind(window)
			: (cb) => setTimeout(cb, 200);
		schedule(() => {
			this.loadProfile({ silent: true, force: true });
		});
	}

	clearCreditsStorage() {
		try {
			window.localStorage?.removeItem('credits-balance');
			window.localStorage?.removeItem('credits-user-email');
			window.localStorage?.removeItem('credits-last-claim');
			window.localStorage?.removeItem('profile-avatar-url');
		} catch {
			// ignore storage errors
		}
	}
}

customElements.define('app-modal-profile', AppModalProfile);
