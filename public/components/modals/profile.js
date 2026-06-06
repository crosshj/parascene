import './account-menu.js';

let fetchJsonWithStatusDeduped;
let invalidateAppCaches;
let getNsfwContentEnabled;
let setNsfwContentEnabled;
let getNsfwObscure;
let setNsfwObscure;
let applyNsfwPreference;
let NSFW_VIEW_BODY_CLASS;
let hydrateChatAudibleNotificationsFromServer;
let setChatAudibleNotificationsEnabled;
let clearChatAudibleNotificationsStorage;
let setFeedBetaEnabledClient;
let feedBetaActiveFromProfile;
let isFeedBetaOptedInFromProfile;

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
		const apiMod = await import(`../../shared/api.js${qs}`);
		fetchJsonWithStatusDeduped = apiMod.fetchJsonWithStatusDeduped;
		invalidateAppCaches = apiMod.invalidateAppCaches;

		const nsfwMod = await import(`../../shared/nsfwView.js${qs}`);
		getNsfwContentEnabled = nsfwMod.getNsfwContentEnabled;
		setNsfwContentEnabled = nsfwMod.setNsfwContentEnabled;
		getNsfwObscure = nsfwMod.getNsfwObscure;
		setNsfwObscure = nsfwMod.setNsfwObscure;
		applyNsfwPreference = nsfwMod.applyNsfwPreference;
		NSFW_VIEW_BODY_CLASS = nsfwMod.NSFW_VIEW_BODY_CLASS;

		const chatAudiblePrefMod = await import(`../../shared/chatAudibleNotificationsPref.js${qs}`);
		hydrateChatAudibleNotificationsFromServer = chatAudiblePrefMod.hydrateChatAudibleNotificationsFromServer;
		setChatAudibleNotificationsEnabled = chatAudiblePrefMod.setChatAudibleNotificationsEnabled;
		clearChatAudibleNotificationsStorage = chatAudiblePrefMod.clearChatAudibleNotificationsStorage;

		const feedBetaNavMod = await import(`../../shared/feedBetaNav.js${qs}`);
		setFeedBetaEnabledClient = feedBetaNavMod.setFeedBetaEnabledClient;
		feedBetaActiveFromProfile = feedBetaNavMod.feedBetaActiveFromProfile;
		isFeedBetaOptedInFromProfile = feedBetaNavMod.isFeedBetaOptedInFromProfile;
	})();
	return _depsPromise;
}

const html = String.raw;

function invalidateOwnPublicProfileCache(profileData) {
	const userId = Number(profileData?.id);
	if (!Number.isFinite(userId) || userId <= 0) return;
	if (typeof invalidateAppCaches !== 'function') return;
	invalidateAppCaches({ urls: [`/api/users/${userId}/profile`] });
}

class AppModalProfile extends HTMLElement {
	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
		this._isOpen = false;
		this.profileLoading = false;
		this.profileLoadedAt = 0;
		this.profileData = null;
		this.handleEscape = this.handleEscape.bind(this);
		this.handleOpenSettingsEvent = this.handleOpenSettingsEvent.bind(this);
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
		document.removeEventListener('open-settings-modal', this.handleOpenSettingsEvent);
		document.removeEventListener('close-profile', this.handleCloseEvent);
		document.removeEventListener('close-all-modals', this.handleCloseAllModals);
	}

	setupEventListeners() {
		document.addEventListener('keydown', this.handleEscape);
		document.addEventListener('open-settings-modal', this.handleOpenSettingsEvent);
		document.addEventListener('close-profile', this.handleCloseEvent);
		document.addEventListener('close-all-modals', this.handleCloseAllModals);

		const overlay = this.shadowRoot.querySelector('.profile-overlay');
		const closeButton = this.shadowRoot.querySelector('.profile-close');
		const settingsClose = this.shadowRoot.querySelector('[data-settings-close]');

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

		if (settingsClose) {
			settingsClose.addEventListener('click', () => this.close());
		}

		this.setupNsfwToggles();
		this.setupShowOwnPostsToggle();
		this.setupForceLegacyFeedToggle();
		this.setupAppearOfflineToggle();
		this.setupAudibleNotificationsToggle();
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
					invalidateOwnPublicProfileCache(this.profileData);
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
					invalidateOwnPublicProfileCache(this.profileData);
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
					invalidateOwnPublicProfileCache(this.profileData);
				} else {
					checkbox.checked = !on;
				}
			} catch {
				checkbox.checked = !on;
			}
		});
	}

	setupShowOwnPostsToggle() {
		const checkbox = this.shadowRoot.querySelector('[data-show-own-posts]');
		if (!checkbox) return;

		const syncFromProfile = () => {
			checkbox.checked = this.profileData?.showOwnPostsInFeed === true;
		};
		syncFromProfile();

		checkbox.addEventListener('change', async () => {
			const showOwnPostsInFeed = checkbox.checked === true;
			try {
				const res = await fetchJsonWithStatusDeduped(
					'/api/profile',
					{
						method: 'PATCH',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ showOwnPostsInFeed })
					},
					{ windowMs: 0 }
				);
				if (res?.ok) {
					if (this.profileData) this.profileData.showOwnPostsInFeed = showOwnPostsInFeed;
					document.dispatchEvent(new CustomEvent('feed-preference-changed'));
					invalidateOwnPublicProfileCache(this.profileData);
				} else {
					checkbox.checked = !showOwnPostsInFeed;
				}
			} catch {
				checkbox.checked = !showOwnPostsInFeed;
			}
		});
	}

	syncForceLegacyFeedVisibility() {
		const wrap = this.shadowRoot.querySelector('[data-force-legacy-wrap]');
		if (!wrap) return;
		if (
			typeof isFeedBetaOptedInFromProfile === 'function' &&
			isFeedBetaOptedInFromProfile(this.profileData)
		) {
			wrap.removeAttribute('hidden');
		} else {
			wrap.setAttribute('hidden', '');
		}
	}

	setupForceLegacyFeedToggle() {
		const checkbox = this.shadowRoot.querySelector('[data-force-legacy-feed]');
		if (!checkbox) return;

		const syncFromProfile = () => {
			this.syncForceLegacyFeedVisibility();
			checkbox.checked = this.profileData?.forceLegacyFeed === true;
		};
		syncFromProfile();

		checkbox.addEventListener('change', async () => {
			const forceLegacyFeed = checkbox.checked === true;
			try {
				const res = await fetchJsonWithStatusDeduped(
					'/api/profile',
					{
						method: 'PATCH',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ forceLegacyFeed })
					},
					{ windowMs: 0 }
				);
				if (res?.ok) {
					if (this.profileData) this.profileData.forceLegacyFeed = forceLegacyFeed;
					if (typeof setFeedBetaEnabledClient === 'function' && typeof feedBetaActiveFromProfile === 'function') {
						setFeedBetaEnabledClient(feedBetaActiveFromProfile(this.profileData));
					}
					document.dispatchEvent(new CustomEvent('feed-preference-changed'));
					invalidateOwnPublicProfileCache(this.profileData);
				} else {
					checkbox.checked = !forceLegacyFeed;
				}
			} catch {
				checkbox.checked = !forceLegacyFeed;
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
		const showOwnPostsBox = this.shadowRoot.querySelector('[data-show-own-posts]');
		if (showOwnPostsBox) {
			showOwnPostsBox.checked = this.profileData?.showOwnPostsInFeed === true;
		}
		const forceLegacyBox = this.shadowRoot.querySelector('[data-force-legacy-feed]');
		if (forceLegacyBox) {
			forceLegacyBox.checked = this.profileData?.forceLegacyFeed === true;
		}
		this.syncForceLegacyFeedVisibility();
	}

	handleOpenSettingsEvent() {
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
			void this.loadProfile({ silent: true }).then(() => {
				this.syncNsfwTogglesFromStorage();
			});
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
					if (!this.profileData && content) {
						content.innerHTML = html`<p style="color: var(--text-muted);">Please log in to change settings.</p>`;
					}
					return;
				}
				throw new Error('Failed to load profile');
			}

			const user = result.data;
			const nextKey = user
				? `${user.id}|${user.hasApiKey ? '1' : '0'}|${user.apiKeyPrefix || ''}|${user.hasVynlyToken ? '1' : '0'}|${user.vynlyTokenPrefix || ''}|${user.enableNsfw ? '1' : '0'}|${user.showOwnPostsInFeed ? '1' : '0'}|${user.audibleNotifications !== false ? '1' : '0'}|${user.appear_offline ? '1' : '0'}|${user.feedBetaEnabled ? '1' : '0'}|${user.forceLegacyFeed ? '1' : '0'}`
				: '';
			const currentKey = this.profileData
				? `${this.profileData.id}|${this.profileData.hasApiKey ? '1' : '0'}|${this.profileData.apiKeyPrefix || ''}|${this.profileData.hasVynlyToken ? '1' : '0'}|${this.profileData.vynlyTokenPrefix || ''}|${this.profileData.enableNsfw ? '1' : '0'}|${this.profileData.showOwnPostsInFeed ? '1' : '0'}|${this.profileData.audibleNotifications !== false ? '1' : '0'}|${this.profileData.appear_offline ? '1' : '0'}|${this.profileData.feedBetaEnabled ? '1' : '0'}|${this.profileData.forceLegacyFeed ? '1' : '0'}`
				: '';

			if (nextKey !== currentKey) {
				this.profileData = user;
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
			if (!silent && !this.profileData && content) {
				content.innerHTML = html`<p style="color: var(--text-muted);">Failed to load profile information.</p>`;
			}
		} finally {
			this.profileLoading = false;
		}
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
          background: rgba(0, 0, 0, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 99999;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transition: opacity 0.2s ease, visibility 0.2s ease;
          padding: 16px;
          box-sizing: border-box;
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
          width: min(94vw, 640px);
          max-width: 640px;
          max-height: min(92vh, 820px);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          transform: scale(0.97);
          transition: transform 0.2s ease;
        }
        .profile-overlay.open .profile-modal {
          transform: scale(1);
        }
        .profile-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 28px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .profile-header h2 {
          margin: 0;
          font-size: 1.2rem;
          font-weight: 650;
          letter-spacing: -0.02em;
        }
        .profile-close {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          transition: background-color 0.15s ease, color 0.15s ease;
        }
        .profile-close:hover {
          background: var(--surface-strong);
          color: var(--text);
        }
        .profile-close-icon {
          width: 22px;
          height: 22px;
        }
        .profile-body {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          padding: 0;
        }
        .settings-scroll {
          overflow-y: auto;
          padding: 24px 28px 20px;
          flex: 1;
          min-height: 0;
        }
        .settings-section {
          margin: 0;
          padding: 0 0 8px 0;
        }
        .settings-section + .settings-section {
          margin-top: 0;
          padding-top: 32px;
          border-top: 1px solid var(--border);
        }
        .settings-section:last-child {
          padding-bottom: 4px;
        }
        .settings-section-title {
          margin: 0 0 18px 0;
          font-size: 0.7rem;
          font-weight: 650;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-muted);
        }
        .settings-section-body {
          padding: 0;
        }
        .settings-subblock + .settings-subblock {
          margin-top: 28px;
          padding-top: 28px;
          border-top: 1px solid var(--border);
        }
        .settings-subheading {
          margin: 0 0 10px 0;
          font-size: 0.98rem;
          font-weight: 600;
          color: var(--text);
        }
        .settings-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          padding: 14px 28px 18px;
          border-top: 1px solid var(--border);
          flex-shrink: 0;
        }
        .btn-secondary,
        a.btn-secondary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 16px;
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          text-decoration: none;
          font-size: 0.9rem;
          transition: background-color 0.15s ease, border-color 0.15s ease;
          cursor: pointer;
          font: inherit;
          border-radius: 6px;
          -webkit-appearance: none;
          appearance: none;
          box-sizing: border-box;
          line-height: 1.2;
        }
        @supports (corner-shape: squircle) {
          .btn-secondary,
          a.btn-secondary {
            border-radius: 10px;
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
        .profile-api-reveal {
          margin-bottom: 12px;
          padding: 12px 0;
          border-radius: 0;
          background: transparent;
          border: none;
          border-left: 3px solid var(--accent);
          padding-left: 14px;
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
          font-size: 0.78rem;
          word-break: break-all;
          padding: 8px 10px;
          border-radius: 6px;
          background: var(--surface-strong);
          border: none;
          font-family: ui-monospace, monospace;
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
        .profile-integration-row {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .profile-integration-row .profile-api-masked {
          flex: 1;
          min-width: 0;
          line-height: 1.4;
        }
        .profile-integration-row--input .profile-api-input {
          flex: 1;
          min-width: 0;
          margin-bottom: 0;
          width: auto;
          max-width: none;
        }
        .profile-integration-hint {
          font-size: 0.85rem;
          color: var(--text-muted);
          line-height: 1.45;
          margin: 0 0 10px 0;
        }
        .profile-integration-hint a {
          color: var(--accent);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .profile-api-input {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          padding: 8px 10px;
          margin-bottom: 10px;
          font-size: 0.85rem;
          font-family: ui-monospace, monospace;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text);
        }
        .profile-presence-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-top: 12px;
        }
        .profile-presence-row:first-child {
          margin-top: 0;
        }
        .profile-presence-row label {
          margin: 0;
          font-weight: 600;
          color: var(--text);
          font-size: 0.9rem;
          line-height: 1.35;
        }
        .profile-presence-row input[type="checkbox"] {
          width: 18px;
          height: 18px;
          margin-top: 2px;
          flex-shrink: 0;
          cursor: pointer;
          accent-color: var(--accent);
        }
        .profile-nsfw-toggles {
          margin: 0;
          padding: 0;
          border: none;
        }
        .profile-nsfw-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-top: 12px;
        }
        .profile-nsfw-row:first-child {
          margin-top: 0;
        }
        .profile-nsfw-row label {
          margin: 0;
          font-weight: 600;
          color: var(--text);
          font-size: 0.9rem;
          line-height: 1.35;
        }
        .profile-nsfw-row input[type="checkbox"] {
          width: 18px;
          height: 18px;
          margin-top: 2px;
          flex-shrink: 0;
          cursor: pointer;
          accent-color: var(--accent);
        }
        [data-nsfw-obscure-wrap][hidden],
        [data-force-legacy-wrap][hidden] {
          display: none !important;
        }
      </style>
      <div class="profile-overlay">
        <div class="profile-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
          <div class="profile-header">
            <h2 id="settings-modal-title">Settings</h2>
            <button type="button" class="profile-close" aria-label="Close">
              <svg class="profile-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="profile-body">
            <div class="settings-scroll">
              <section class="settings-section" aria-labelledby="settings-presence-heading">
                <h3 class="settings-section-title" id="settings-presence-heading">Presence &amp; chat</h3>
                <div class="settings-section-body">
                  <div class="profile-presence-block">
                    <div class="profile-presence-row">
                      <label for="profile-appear-offline">Appear offline</label>
                      <input type="checkbox" id="profile-appear-offline" data-appear-offline />
                    </div>
                    <div class="profile-presence-row">
                      <label for="profile-audible-notifications">Audible notifications</label>
                      <input type="checkbox" id="profile-audible-notifications" data-audible-notifications />
                    </div>
                  </div>
                </div>
              </section>
              <section class="settings-section" aria-labelledby="settings-content-heading">
                <h3 class="settings-section-title" id="settings-content-heading">Content</h3>
                <div class="settings-section-body">
                  <div class="profile-nsfw-toggles">
                    <div class="profile-nsfw-row">
                      <label for="profile-nsfw-enable">Enable NSFW content</label>
                      <input type="checkbox" id="profile-nsfw-enable" data-nsfw-enable />
                    </div>
                    <div class="profile-nsfw-row" data-nsfw-obscure-wrap hidden>
                      <label for="profile-nsfw-obscure">Show NSFW unobscured</label>
                      <input type="checkbox" id="profile-nsfw-obscure" data-nsfw-obscure />
                    </div>
                    <div class="profile-nsfw-row">
                      <label for="profile-show-own-posts">Show my posts in feed</label>
                      <input type="checkbox" id="profile-show-own-posts" data-show-own-posts />
                    </div>
                    <div class="profile-nsfw-row" data-force-legacy-wrap hidden>
                      <label for="profile-force-legacy-feed">Force legacy feed</label>
                      <input type="checkbox" id="profile-force-legacy-feed" data-force-legacy-feed />
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
          <div class="settings-footer">
            <button type="button" class="btn-secondary" data-settings-close>Close</button>
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
			// Match CHAT_SIDEBAR_SESSION_ROSTER_KEY in shared/chatSidebarSessionCache.js
			window.sessionStorage?.removeItem('prsn-chat-sidebar-roster-v1');
			if (typeof clearChatAudibleNotificationsStorage === 'function') {
				clearChatAudibleNotificationsStorage();
			}
		} catch {
			// ignore storage errors
		}
	}
}

customElements.define('app-modal-profile', AppModalProfile);
