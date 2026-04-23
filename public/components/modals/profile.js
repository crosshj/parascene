let formatDate;
let fetchJsonWithStatusDeduped;
let buildProfilePath;
let helpIcon;
let getHelpHref;
let getNsfwContentEnabled;
let setNsfwContentEnabled;
let getNsfwObscure;
let setNsfwObscure;
let applyNsfwPreference;
let NSFW_VIEW_BODY_CLASS;
let hydrateChatAudibleNotificationsFromServer;
let setChatAudibleNotificationsEnabled;
let clearChatAudibleNotificationsStorage;

function getAssetVersionParam() {
	const meta = document.querySelector('meta[name="asset-version"]');
	return meta?.getAttribute('content')?.trim() || '';
}

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

let _depsPromise;
async function loadDeps() {
	if (_depsPromise) return _depsPromise;
	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	_depsPromise = (async () => {
		const datetimeMod = await import(`../../shared/datetime.js${qs}`);
		formatDate = datetimeMod.formatDate;

		const apiMod = await import(`../../shared/api.js${qs}`);
		fetchJsonWithStatusDeduped = apiMod.fetchJsonWithStatusDeduped;

		const profileLinksMod = await import(`../../shared/profileLinks.js${qs}`);
		buildProfilePath = profileLinksMod.buildProfilePath;

		const iconsMod = await import(`../../icons/svg-strings.js${qs}`);
		helpIcon = iconsMod.helpIcon;

		const nsfwMod = await import(`../../shared/nsfwView.js${qs}`);
		getNsfwContentEnabled = nsfwMod.getNsfwContentEnabled;
		setNsfwContentEnabled = nsfwMod.setNsfwContentEnabled;
		getNsfwObscure = nsfwMod.getNsfwObscure;
		setNsfwObscure = nsfwMod.setNsfwObscure;
		applyNsfwPreference = nsfwMod.applyNsfwPreference;
		NSFW_VIEW_BODY_CLASS = nsfwMod.NSFW_VIEW_BODY_CLASS;

		const helpUrlMod = await import(`../../shared/helpUrl.js${qs}`);
		getHelpHref = helpUrlMod.getHelpHref;

		const chatAudiblePrefMod = await import(`../../shared/chatAudibleNotificationsPref.js${qs}`);
		hydrateChatAudibleNotificationsFromServer = chatAudiblePrefMod.hydrateChatAudibleNotificationsFromServer;
		setChatAudibleNotificationsEnabled = chatAudiblePrefMod.setChatAudibleNotificationsEnabled;
		clearChatAudibleNotificationsStorage = chatAudiblePrefMod.clearChatAudibleNotificationsStorage;
	})();
	return _depsPromise;
}

const html = String.raw;

class AppModalProfile extends HTMLElement {
	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
		this._isOpen = false;
		this.profileLoading = false;
		this.profileLoadedAt = 0;
		this.profileData = null;
		this.revealedApiKey = null;
		this.handleEscape = this.handleEscape.bind(this);
		this.handleOpenEvent = this.handleOpenEvent.bind(this);
		this.handleCloseEvent = this.handleCloseEvent.bind(this);
		this.handleCloseAllModals = this.handleCloseAllModals.bind(this);
	}

	async connectedCallback() {
		await loadDeps();
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
		this.setupAppearOfflineToggle();
		this.setupAudibleNotificationsToggle();
		this.setupApiKeyActions();
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

	setupAppearOfflineToggle() {
		const checkbox = this.shadowRoot.querySelector('[data-appear-offline]');
		if (!checkbox) return;

		const syncFromProfile = () => {
			checkbox.checked = this.profileData?.appear_offline === true;
		};
		syncFromProfile();

		checkbox.addEventListener('change', async () => {
			const appearOffline = checkbox.checked === true;
			try {
				const res = await fetchJsonWithStatusDeduped(
					'/api/presence/settings',
					{
						method: 'PATCH',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ appear_offline: appearOffline })
					},
					{ windowMs: 0 }
				);
				if (res?.ok) {
					if (this.profileData) this.profileData.appear_offline = appearOffline;
				} else {
					checkbox.checked = !appearOffline;
				}
			} catch {
				checkbox.checked = !appearOffline;
			}
		});
	}

	setupAudibleNotificationsToggle() {
		const checkbox = this.shadowRoot.querySelector('[data-audible-notifications]');
		if (!checkbox) return;

		const syncFromProfile = () => {
			checkbox.checked = this.profileData?.audibleNotifications !== false;
		};
		syncFromProfile();

		checkbox.addEventListener('change', async () => {
			const on = checkbox.checked === true;
			try {
				const res = await fetchJsonWithStatusDeduped(
					'/api/profile',
					{
						method: 'PATCH',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ audibleNotifications: on })
					},
					{ windowMs: 0 }
				);
				if (res?.ok) {
					if (this.profileData) this.profileData.audibleNotifications = on;
					setChatAudibleNotificationsEnabled(on);
				} else {
					checkbox.checked = !on;
				}
			} catch {
				checkbox.checked = !on;
			}
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
		const appearOfflineBox = this.shadowRoot.querySelector('[data-appear-offline]');
		if (appearOfflineBox) {
			appearOfflineBox.checked = this.profileData?.appear_offline === true;
		}
		const audibleBox = this.shadowRoot.querySelector('[data-audible-notifications]');
		if (audibleBox) {
			audibleBox.checked = this.profileData?.audibleNotifications !== false;
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
		this.revealedApiKey = null;
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
				? `${user.email || ''}|${user.hasApiKey ? '1' : '0'}|${user.apiKeyPrefix || ''}|${user.created_at || ''}`
				: '';
			const currentKey = this.profileData
				? `${this.profileData.email || ''}|${this.profileData.hasApiKey ? '1' : '0'}|${this.profileData.apiKeyPrefix || ''}|${this.profileData.created_at || ''}`
				: '';

			if (nextKey !== currentKey) {
				this.profileData = user;
				this.displayProfile(user);
			}
			this.profileLoadedAt = Date.now();
			// Keep localStorage in sync with server so publish modal and others get correct default
			if (user) setNsfwContentEnabled(user.enableNsfw === true);
			if (user && typeof hydrateChatAudibleNotificationsFromServer === 'function') {
				hydrateChatAudibleNotificationsFromServer(user.audibleNotifications);
			}
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

		const escapeHtml = (text) => {
			const div = document.createElement('div');
			div.textContent = text;
			return div.innerHTML;
		};

		const hasKey = user.hasApiKey === true;
		const apiKeyMasked = '•'.repeat(24);

		const revealBlock = this.revealedApiKey
			? html`
			<div class="profile-api-reveal" role="status">
				<p class="profile-api-reveal-label">Copy your key now — it won’t be shown again.</p>
				<div class="profile-api-reveal-row">
					<code class="profile-api-reveal-code">${escapeHtml(this.revealedApiKey)}</code>
					<button type="button" class="btn-secondary" data-profile-api-copy>Copy</button>
				</div>
			</div>`
			: '';

		const keyActions = hasKey
			? html`
			<p class="profile-api-active">Active key: <span class="profile-api-masked" aria-hidden="true">${apiKeyMasked}</span></p>
			<div class="profile-api-actions">
				<button type="button" class="btn-secondary" data-profile-api-generate>Generate new key</button>
				<button type="button" class="btn-secondary is-logout" data-profile-api-remove>Remove API key</button>
			</div>`
			: html`
			<div class="profile-api-actions">
				<button type="button" class="btn-secondary" data-profile-api-generate>Generate API key</button>
			</div>`;

		content.innerHTML = html`
	<div class="field">
		<label>Email</label>
		<div class="value">${escapeHtml(user.email)}</div>
	</div>
	<div class="field">
		<label>Member Since</label>
		<div class="value">${formatDate(user.created_at) || 'N/A'}</div>
	</div>
	<div class="profile-api-key-section">
		<div class="field">
			<label>API key</label>
			<p class="profile-api-hint">Use in the Authorization header: Bearer &lt;key&gt;</p>
			${revealBlock}
			${keyActions}
		</div>
	</div>
    `;
	}

	setupApiKeyActions() {
		this.shadowRoot.addEventListener('click', async (e) => {
			const gen = e.target.closest?.('[data-profile-api-generate]');
			const rem = e.target.closest?.('[data-profile-api-remove]');
			const copy = e.target.closest?.('[data-profile-api-copy]');
			if (gen) {
				e.preventDefault();
				try {
					const res = await fetchJsonWithStatusDeduped('/api/profile/api-key', {
						method: 'POST',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' }
					}, { windowMs: 0 });
					if (res?.ok && typeof res.data?.apiKey === 'string') {
						this.revealedApiKey = res.data.apiKey;
						if (this.profileData) {
							this.profileData.hasApiKey = true;
							this.profileData.apiKeyPrefix = `${res.data.apiKey.slice(0, 10)}…`;
						}
						this.displayProfile(this.profileData || {});
					}
				} catch {
					// ignore
				}
				return;
			}
			if (rem) {
				e.preventDefault();
				if (!window.confirm('Remove this API key? Apps using it will stop working.')) return;
				try {
					const res = await fetchJsonWithStatusDeduped('/api/profile/api-key', {
						method: 'DELETE',
						credentials: 'include'
					}, { windowMs: 0 });
					if (res?.ok) {
						this.revealedApiKey = null;
						if (this.profileData) {
							this.profileData.hasApiKey = false;
							this.profileData.apiKeyPrefix = null;
						}
						await this.loadProfile({ silent: true, force: true });
					}
				} catch {
					// ignore
				}
				return;
			}
			if (copy && this.revealedApiKey) {
				e.preventDefault();
				try {
					await navigator.clipboard.writeText(this.revealedApiKey);
				} catch {
					// ignore
				}
			}
		});
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
          pointer-events: none;
          transition: opacity 0.2s, visibility 0.2s;
        }
        .profile-overlay.open {
          opacity: 1;
          visibility: visible;
          pointer-events: auto;
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
        .profile-api-key-section {
          margin-top: 4px;
          padding-top: 16px;
          border-top: 1px solid var(--border);
        }
        .profile-api-hint {
          font-size: 0.85rem;
          color: var(--text-muted);
          margin: 0 0 12px 0;
          line-height: 1.35;
        }
        .profile-api-reveal {
          margin-bottom: 12px;
          padding: 12px;
          border-radius: 10px;
          background: var(--surface-strong);
          border: 1px solid var(--border);
        }
        .profile-api-reveal-label {
          margin: 0 0 8px 0;
          font-size: 0.9rem;
          color: var(--text-muted);
        }
        .profile-api-reveal-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .profile-api-reveal-code {
          flex: 1;
          min-width: 0;
          font-size: 0.8rem;
          word-break: break-all;
          padding: 8px 10px;
          border-radius: 6px;
          background: var(--surface);
          border: 1px solid var(--border);
          font-family: ui-monospace, monospace;
        }
        .profile-api-active {
          margin: 0 0 10px 0;
          font-size: 0.95rem;
          color: var(--text);
        }
        .profile-api-masked {
          font-family: ui-monospace, monospace;
          letter-spacing: 0.12em;
          user-select: none;
        }
        .profile-api-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .profile-presence-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: 10px 0 0 0;
        }
        .profile-presence-row label {
          margin: 0;
          font-weight: 600;
          color: var(--text-muted);
          font-size: 0.9rem;
        }
        .profile-presence-row input[type="checkbox"] {
          width: 18px;
          height: 18px;
          cursor: pointer;
          accent-color: var(--accent);
        }
        .profile-presence-hint {
          margin: 6px 0 0 0;
          font-size: 0.85rem;
          color: var(--text-muted);
          line-height: 1.35;
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
            <div class="profile-presence-block">
              <div class="profile-presence-row">
                <label for="profile-appear-offline">Appear offline</label>
                <input type="checkbox" id="profile-appear-offline" data-appear-offline aria-describedby="profile-appear-offline-desc" />
              </div>
              <p id="profile-appear-offline-desc" class="profile-presence-hint">When checked, you are hidden from the public online list.</p>
              <div class="profile-presence-row">
                <label for="profile-audible-notifications">Audible notifications</label>
                <input type="checkbox" id="profile-audible-notifications" data-audible-notifications aria-describedby="profile-audible-notifications-desc" />
              </div>
              <p id="profile-audible-notifications-desc" class="profile-presence-hint">Play a sound for new chat activity when this tab is in the background.</p>
            </div>
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
            <a class="btn-secondary" href="${getHelpHref("/help")}">${helpIcon('profile-action-icon')} Help</a>
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
			// Match CHAT_THREADS_CACHE_KEY in shared/chatThreadsCache.js
			window.localStorage?.removeItem('prsn-chat-threads-v1');
			if (typeof clearChatAudibleNotificationsStorage === 'function') {
				clearChatAudibleNotificationsStorage();
			}
		} catch {
			// ignore storage errors
		}
	}
}

customElements.define('app-modal-profile', AppModalProfile);
