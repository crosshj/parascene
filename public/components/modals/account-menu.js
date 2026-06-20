let fetchJsonWithStatusDeduped;
let buildProfilePath;
let clearChatAudibleNotificationsStorage;
let getHelpHref;
let userProfileIcon;
let gearIcon;
let helpIcon;
let globeIcon;
let logOutIcon;
let infoIcon;
let confirmAndHardReloadAfterClearingCaches;

function getAssetVersionParam() {
	const meta = document.querySelector('meta[name="asset-version"]');
	return meta?.getAttribute('content')?.trim() || '';
}

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

let _depsPromise;
async function loadAccountMenuDeps() {
	if (_depsPromise) return _depsPromise;
	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	_depsPromise = (async () => {
		const apiMod = await import(`../../shared/api.js${qs}`);
		fetchJsonWithStatusDeduped = apiMod.fetchJsonWithStatusDeduped;
		const profileLinksMod = await import(`../../shared/profileLinks.js${qs}`);
		buildProfilePath = profileLinksMod.buildProfilePath;
		const chatAudiblePrefMod = await import(`../../shared/chatAudibleNotificationsPref.js${qs}`);
		clearChatAudibleNotificationsStorage = chatAudiblePrefMod.clearChatAudibleNotificationsStorage;
		const helpUrlMod = await import(`../../shared/helpUrl.js${qs}`);
		getHelpHref = helpUrlMod.getHelpHref;
		const iconsMod = await import(`../../icons/svg-strings.js${qs}`);
		userProfileIcon = iconsMod.userProfileIcon;
		gearIcon = iconsMod.gearIcon;
		helpIcon = iconsMod.helpIcon;
		globeIcon = iconsMod.globeIcon;
		logOutIcon = iconsMod.logOutIcon;
		infoIcon = iconsMod.infoIcon;
		const clearMod = await import(`../../shared/clearClientCaches.js${qs}`);
		confirmAndHardReloadAfterClearingCaches = clearMod.confirmAndHardReloadAfterClearingCaches;
	})();
	return _depsPromise;
}

function clearLogoutSideEffects() {
	try {
		window.localStorage?.removeItem('credits-balance');
		window.localStorage?.removeItem('credits-user-email');
		window.localStorage?.removeItem('credits-last-claim');
		window.localStorage?.removeItem('profile-avatar-url');
		window.localStorage?.removeItem('prsn-chat-threads-v1');
		window.sessionStorage?.removeItem('prsn-chat-sidebar-roster-v1');
		if (typeof clearChatAudibleNotificationsStorage === 'function') {
			clearChatAudibleNotificationsStorage();
		}
	} catch {
		// ignore
	}
}

function resolveMenuAnchor(detailAnchor) {
	if (detailAnchor instanceof Element) return detailAnchor;
	const navBtn = document.querySelector('app-navigation .profile-button');
	if (navBtn) return navBtn;
	const chatBtn = document.querySelector('[data-chat-sidebar-open-profile]');
	if (chatBtn) return chatBtn;
	return null;
}

/**
 * Fixed point top-right when no anchor (e.g. programmatic open).
 */
function fallbackAnchorRect() {
	const pad = 12;
	const top = 56;
	const right = window.innerWidth - pad;
	return { left: right, top, width: 0, height: 0, right, bottom: top };
}

const html = String.raw;

class AppAccountMenu extends HTMLElement {
	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
		this._open = false;
		this._initPromise = null;
		this._backdropPointerDown = this._backdropPointerDown.bind(this);
		this._onKeydown = this._onKeydown.bind(this);
		this._onPanelClick = this._onPanelClick.bind(this);
	}

	connectedCallback() {
		this._initPromise = loadAccountMenuDeps().then(() => this.renderShell());
	}

	renderShell() {
		if (this.shadowRoot.querySelector('.account-menu-panel')) return;
		const helpHref = typeof getHelpHref === 'function' ? getHelpHref('/help') : '/help';
		this.shadowRoot.innerHTML = html`
			<style>
				:host {
					display: block;
					position: fixed;
					inset: 0;
					z-index: 100000;
					pointer-events: none;
					opacity: 0;
					visibility: hidden;
					transition: opacity 0.15s ease, visibility 0.15s ease;
				}
				:host([data-open='true']) {
					pointer-events: auto;
					opacity: 1;
					visibility: visible;
				}
				.account-menu-backdrop {
					position: absolute;
					inset: 0;
					background: transparent;
				}
				.account-menu-panel {
					position: absolute;
					z-index: 1;
					min-width: 220px;
					max-width: min(280px, calc(100vw - 16px));
					background: var(--surface);
					border: 1px solid var(--border);
					border-radius: 10px;
					box-shadow: var(--shadow);
					padding: 6px 0;
					font: inherit;
				}
				.account-menu-item,
				.account-menu-link {
					display: flex;
					align-items: center;
					gap: 10px;
					width: 100%;
					box-sizing: border-box;
					text-align: left;
					padding: 10px 14px;
					border: none;
					background: transparent;
					color: var(--text);
					font-size: 0.95rem;
					cursor: pointer;
					transition: background 0.12s ease, color 0.12s ease;
					text-decoration: none;
					font: inherit;
				}
				.account-menu-item:hover,
				.account-menu-link:hover {
					background: var(--surface-strong);
				}
				.account-menu-item.danger,
				.account-menu-link.danger {
					color: var(--danger, #e85d6a);
				}
				.account-menu-item.danger:hover,
				.account-menu-link.danger:hover {
					background: var(--surface-strong);
				}
				.account-menu-svg {
					width: 18px;
					height: 18px;
					flex-shrink: 0;
					color: var(--text-muted);
				}
				.account-menu-item:hover .account-menu-svg,
				.account-menu-link:hover .account-menu-svg {
					color: var(--text);
				}
				.account-menu-item.danger .account-menu-svg,
				.account-menu-link.danger .account-menu-svg {
					color: inherit;
				}
				.account-menu-label {
					flex: 1;
					min-width: 0;
				}
				.account-menu-divider {
					height: 1px;
					margin: 6px 0;
					background: var(--border);
				}
			</style>
			<div class="account-menu-backdrop" part="backdrop"></div>
			<div class="account-menu-panel" part="panel" role="menu" aria-label="Account">
				<button type="button" class="account-menu-item" data-action="view-profile" role="menuitem">
					${userProfileIcon('account-menu-svg')}
					<span class="account-menu-label">View Profile</span>
				</button>
				<button type="button" class="account-menu-item" data-action="integrations" role="menuitem">
					${globeIcon('account-menu-svg')}
					<span class="account-menu-label">Connections</span>
				</button>
				<button type="button" class="account-menu-item" data-action="settings" role="menuitem">
					${gearIcon('account-menu-svg')}
					<span class="account-menu-label">Settings</span>
				</button>
				<a class="account-menu-link" href="${helpHref}" role="menuitem">
					${helpIcon('account-menu-svg')}
					<span class="account-menu-label">Help</span>
				</a>
				<div class="account-menu-divider" aria-hidden="true"></div>
				<button type="button" class="account-menu-item" data-action="about" role="menuitem">
					${infoIcon('account-menu-svg')}
					<span class="account-menu-label">About</span>
				</button>
				<button type="button" class="account-menu-item" data-action="clear-cache" role="menuitem">
					${gearIcon('account-menu-svg')}
					<span class="account-menu-label">Clear cache</span>
				</button>
				<button type="button" class="account-menu-item danger" data-action="logout" role="menuitem">
					${logOutIcon('account-menu-svg')}
					<span class="account-menu-label">Log Out</span>
				</button>
			</div>
		`;

		const backdrop = this.shadowRoot.querySelector('.account-menu-backdrop');
		const panel = this.shadowRoot.querySelector('.account-menu-panel');
		backdrop?.addEventListener('pointerdown', this._backdropPointerDown);
		panel?.addEventListener('click', this._onPanelClick);
	}

	_backdropPointerDown(e) {
		if (e.target === this.shadowRoot.querySelector('.account-menu-backdrop')) {
			this.close();
		}
	}

	_onKeydown(e) {
		if (e.key === 'Escape') this.close();
	}

	async _onPanelClick(e) {
		const helpLink = e.target.closest?.('a.account-menu-link');
		if (helpLink) {
			this.close();
			return;
		}
		const btn = e.target.closest?.('[data-action]');
		if (!btn) return;
		const action = btn.getAttribute('data-action');
		if (action === 'view-profile') {
			e.preventDefault();
			this.close();
			await loadAccountMenuDeps();
			try {
				const res = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 0 });
				if (res?.ok && res.data) {
					const href =
						buildProfilePath({
							userName: res.data.profile?.user_name,
							userId: res.data.id
						}) || '/user';
					window.location.href = href;
					return;
				}
			} catch {
				// fall through
			}
			window.location.href = '/user';
			return;
		}
		if (action === 'settings') {
			e.preventDefault();
			this.close();
			document.dispatchEvent(new CustomEvent('open-settings-modal'));
			return;
		}
		if (action === 'integrations') {
			e.preventDefault();
			this.close();
			window.location.href = '/integrations';
			return;
		}
		if (action === 'logout') {
			e.preventDefault();
			this.close();
			await loadAccountMenuDeps();
			clearLogoutSideEffects();
			const form = document.createElement('form');
			form.method = 'post';
			form.action = '/logout';
			document.body.appendChild(form);
			form.submit();
			return;
		}
		if (action === 'about') {
			e.preventDefault();
			this.close();
			await loadAccountMenuDeps();
			const v = getAssetVersionParam();
			const qs = getImportQuery(v);
			const aboutMod = await import(`./about.js${qs}`);
			await aboutMod.openAboutModal();
			return;
		}
		if (action === 'clear-cache') {
			e.preventDefault();
			this.close();
			await loadAccountMenuDeps();
			if (typeof confirmAndHardReloadAfterClearingCaches === 'function') {
				await confirmAndHardReloadAfterClearingCaches();
			}
		}
	}

	async open(anchor) {
		await this._initPromise;
		const el = resolveMenuAnchor(anchor);
		const rect = el?.getBoundingClientRect?.() ?? null;
		const r = rect && Number.isFinite(rect.top) ? rect : fallbackAnchorRect();
		const panel = this.shadowRoot.querySelector('.account-menu-panel');
		if (!panel) return;

		const gap = 8;
		const menuW = 248;

		const place = () => {
			const menuH = panel.getBoundingClientRect().height || 180;
			let left = r.right - menuW;
			left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
			let top = r.bottom + gap;
			if (top + menuH > window.innerHeight - 8) {
				top = r.top - menuH - gap;
			}
			top = Math.max(8, Math.min(top, window.innerHeight - menuH - 8));
			panel.style.left = `${Math.round(left)}px`;
			panel.style.top = `${Math.round(top)}px`;
			panel.style.width = `${menuW}px`;
		};

		this.setAttribute('data-open', 'true');
		this._open = true;
		document.addEventListener('keydown', this._onKeydown);
		document.dispatchEvent(new CustomEvent('close-notifications'));
		requestAnimationFrame(() => {
			place();
			requestAnimationFrame(place);
		});
	}

	close() {
		if (!this._open) return;
		this._open = false;
		this.removeAttribute('data-open');
		document.removeEventListener('keydown', this._onKeydown);
	}
}

customElements.define('app-account-menu', AppAccountMenu);

function ensureAccountMenuHost() {
	let el = document.querySelector('app-account-menu');
	if (!el) {
		el = document.createElement('app-account-menu');
		document.body.appendChild(el);
	}
	return el;
}

document.addEventListener('open-account-menu', (ev) => {
	const anchor = ev.detail?.anchor;
	void ensureAccountMenuHost().open(anchor);
});

document.addEventListener('close-profile', () => {
	document.querySelector('app-account-menu')?.close?.();
});
