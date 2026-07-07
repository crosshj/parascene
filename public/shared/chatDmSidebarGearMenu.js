import { isDmPinKeyActive, pinDmKey, unpinDmKey } from './chatDmPins.js';

let menuEl = null;
let outsideHandler = null;
let escHandler = null;
let closeDmConfirmEl = null;
let closeDmConfirmEscHandler = null;

function dmTitleFromGearBtn(btn) {
	const row = btn?.closest?.('.chat-page-sidebar-row, .chat-page-sidebar-row--dm-with-menu');
	const titleEl = row?.querySelector?.('.chat-page-sidebar-row-title');
	const title = titleEl?.textContent?.trim();
	return title || 'this conversation';
}

function closeCloseDmConfirm() {
	if (closeDmConfirmEl) {
		closeDmConfirmEl.classList.remove('open');
		closeDmConfirmEl.setAttribute('aria-hidden', 'true');
		const errEl = closeDmConfirmEl.querySelector('[data-chat-dm-close-confirm-error]');
		if (errEl instanceof HTMLElement) {
			errEl.hidden = true;
			errEl.textContent = '';
		}
		const confirmBtn = closeDmConfirmEl.querySelector('[data-chat-dm-close-confirm-submit]');
		if (confirmBtn instanceof HTMLButtonElement) {
			confirmBtn.disabled = false;
			confirmBtn.classList.remove('is-loading');
			confirmBtn.removeAttribute('aria-busy');
		}
		const cancelBtn = closeDmConfirmEl.querySelector('[data-chat-dm-close-confirm-cancel]');
		if (cancelBtn instanceof HTMLButtonElement) cancelBtn.disabled = false;
	}
	if (closeDmConfirmEscHandler) {
		document.removeEventListener('keydown', closeDmConfirmEscHandler, true);
		closeDmConfirmEscHandler = null;
	}
	try {
		document.body.classList.remove('modal-open');
	} catch {
		// ignore
	}
}

function ensureCloseDmConfirmEl() {
	if (closeDmConfirmEl) return closeDmConfirmEl;
	const overlay = document.createElement('div');
	overlay.className = 'chat-dm-close-confirm-overlay';
	overlay.setAttribute('aria-hidden', 'true');
	overlay.innerHTML = `<div class="chat-dm-close-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="chat-dm-close-confirm-title">
		<h3 id="chat-dm-close-confirm-title" class="chat-dm-close-confirm-title">Close DM</h3>
		<p class="chat-dm-close-confirm-message" data-chat-dm-close-confirm-message></p>
		<p class="alert error chat-dm-close-confirm-error" data-chat-dm-close-confirm-error hidden></p>
		<div class="chat-dm-close-confirm-footer">
			<button type="button" class="btn-secondary" data-chat-dm-close-confirm-cancel>Cancel</button>
			<button type="button" class="btn-primary chat-dm-close-confirm-submit" data-chat-dm-close-confirm-submit>
				<span class="chat-dm-close-confirm-submit-label">Close DM</span>
				<span class="chat-dm-close-confirm-submit-spinner" aria-hidden="true"></span>
			</button>
		</div>
	</div>`;
	overlay.addEventListener('click', (ev) => {
		if (ev.target === overlay) closeCloseDmConfirm();
	});
	const cancelBtn = overlay.querySelector('[data-chat-dm-close-confirm-cancel]');
	if (cancelBtn instanceof HTMLButtonElement) {
		cancelBtn.addEventListener('click', () => closeCloseDmConfirm());
	}
	document.body.appendChild(overlay);
	closeDmConfirmEl = overlay;
	return overlay;
}

/**
 * @param {{ dmTitle?: string, onConfirm?: () => (void | Promise<void>) }} opts
 */
function openCloseDmConfirm(opts = {}) {
	const overlay = ensureCloseDmConfirmEl();
	const dmTitle = typeof opts.dmTitle === 'string' && opts.dmTitle.trim() ? opts.dmTitle.trim() : 'this conversation';
	const msgEl = overlay.querySelector('[data-chat-dm-close-confirm-message]');
	if (msgEl instanceof HTMLElement) {
		msgEl.textContent = `Close your DM with ${dmTitle}? It will reappear in your sidebar if they message you again.`;
	}
	const errEl = overlay.querySelector('[data-chat-dm-close-confirm-error]');
	if (errEl instanceof HTMLElement) {
		errEl.hidden = true;
		errEl.textContent = '';
	}
	const confirmBtn = overlay.querySelector('[data-chat-dm-close-confirm-submit]');
	const cancelBtn = overlay.querySelector('[data-chat-dm-close-confirm-cancel]');
	if (confirmBtn instanceof HTMLButtonElement) {
		confirmBtn.disabled = false;
		confirmBtn.classList.remove('is-loading');
		confirmBtn.removeAttribute('aria-busy');
	}
	if (cancelBtn instanceof HTMLButtonElement) cancelBtn.disabled = false;

	overlay.classList.add('open');
	overlay.setAttribute('aria-hidden', 'false');
	try {
		document.body.classList.add('modal-open');
	} catch {
		// ignore
	}

	if (closeDmConfirmEscHandler) {
		document.removeEventListener('keydown', closeDmConfirmEscHandler, true);
	}
	closeDmConfirmEscHandler = (ev) => {
		if (ev.key === 'Escape') closeCloseDmConfirm();
	};
	document.addEventListener('keydown', closeDmConfirmEscHandler, true);

	const onConfirm = typeof opts.onConfirm === 'function' ? opts.onConfirm : null;
	if (confirmBtn instanceof HTMLButtonElement) {
		confirmBtn.onclick = () => {
			if (!onConfirm || confirmBtn.classList.contains('is-loading')) return;
			errEl.hidden = true;
			errEl.textContent = '';
			confirmBtn.disabled = true;
			confirmBtn.classList.add('is-loading');
			confirmBtn.setAttribute('aria-busy', 'true');
			if (cancelBtn instanceof HTMLButtonElement) cancelBtn.disabled = true;
			void Promise.resolve(onConfirm())
				.then(() => {
					closeCloseDmConfirm();
				})
				.catch((err) => {
					if (errEl instanceof HTMLElement) {
						errEl.hidden = false;
						errEl.textContent = err?.message || 'Could not close DM.';
					}
					confirmBtn.disabled = false;
					confirmBtn.classList.remove('is-loading');
					confirmBtn.removeAttribute('aria-busy');
					if (cancelBtn instanceof HTMLButtonElement) cancelBtn.disabled = false;
				});
		};
	}
	requestAnimationFrame(() => cancelBtn?.focus?.());
}

export function closeDmSidebarGearMenu() {
	if (menuEl) {
		menuEl.remove();
		menuEl = null;
	}
	if (outsideHandler) {
		document.removeEventListener('click', outsideHandler, true);
		outsideHandler = null;
	}
	if (escHandler) {
		document.removeEventListener('keydown', escHandler, true);
		escHandler = null;
	}
}

/**
 * @param {HTMLButtonElement} btn
 * @param {{
 *   onAfterPinChange?: () => void,
 *   onMarkAsRead?: () => (void | Promise<void>),
 *   onViewProfile?: (href: string) => void,
 *   showProfile?: boolean,
 *   showPinToggle?: boolean,
 *   showRemove?: boolean,
 *   extraItems?: Array<{ action: string, label: string }>,
 *   onAction?: (action: string) => (void | Promise<void>),
 *   onRemove?: () => (void | Promise<void>)
 * }} [opts]
 */
export function openDmSidebarGearMenu(btn, opts = {}) {
	closeDmSidebarGearMenu();
	const pinKey = btn.getAttribute('data-chat-dm-menu') || '';
	const profileHrefRaw = btn.getAttribute('data-chat-dm-profile-href') || '';
	const profileHref =
		profileHrefRaw.trim() ||
		(() => {
			const id = Number(btn.getAttribute('data-chat-dm-other-user-id'));
			return Number.isFinite(id) && id > 0 ? `/user/${id}` : '/user';
		})();
	const inDmContext =
		Boolean(pinKey.trim()) ||
		Boolean(btn.getAttribute('data-chat-dm-profile-href')) ||
		Boolean(btn.getAttribute('data-chat-dm-other-user-id'));
	const pinned = isDmPinKeyActive(pinKey);
	const showProfile = opts.showProfile === true || (opts.showProfile !== false && inDmContext);
	const showPinToggle = opts.showPinToggle === true || (opts.showPinToggle !== false && Boolean(pinKey.trim()));
	const showRemove = opts.showRemove === true && Boolean(pinKey.trim());

	const menu = document.createElement('div');
	menu.className = 'feed-card-menu chat-page-sidebar-dm-row-menu';
	menu.setAttribute('role', 'menu');
	menu.style.position = 'fixed';
	menu.style.zIndex = '100002';
	menu.style.boxSizing = 'border-box';

	if (showProfile) {
		const itemProfile = document.createElement('button');
		itemProfile.type = 'button';
		itemProfile.className = 'feed-card-menu-item';
		itemProfile.setAttribute('role', 'menuitem');
		itemProfile.dataset.chatDmMenuAction = 'profile';
		itemProfile.dataset.chatDmMenuProfileHref = profileHref;
		itemProfile.textContent = 'View Profile';
		menu.appendChild(itemProfile);
	}

	if (typeof opts.onMarkAsRead === 'function') {
		const markRead = document.createElement('button');
		markRead.type = 'button';
		markRead.className = 'feed-card-menu-item';
		markRead.setAttribute('role', 'menuitem');
		markRead.dataset.chatDmMenuAction = 'mark-read';
		markRead.textContent = 'Mark as Read';
		menu.appendChild(markRead);
	}

	if (showPinToggle) {
		if (pinned) {
			const unpin = document.createElement('button');
			unpin.type = 'button';
			unpin.className = 'feed-card-menu-item';
			unpin.setAttribute('role', 'menuitem');
			unpin.dataset.chatDmMenuAction = 'unpin';
			unpin.dataset.chatDmMenuKey = pinKey;
			unpin.textContent = 'Unpin Chat';
			menu.appendChild(unpin);
		} else {
			const pin = document.createElement('button');
			pin.type = 'button';
			pin.className = 'feed-card-menu-item';
			pin.setAttribute('role', 'menuitem');
			pin.dataset.chatDmMenuAction = 'pin';
			pin.dataset.chatDmMenuKey = pinKey;
			pin.textContent = 'Pin Chat';
			menu.appendChild(pin);
		}
	}

	if (showRemove) {
		const remove = document.createElement('button');
		remove.type = 'button';
		remove.className = 'feed-card-menu-item';
		remove.setAttribute('role', 'menuitem');
		remove.dataset.chatDmMenuAction = 'remove';
		remove.dataset.chatDmMenuKey = pinKey;
		remove.textContent = 'Close DM';
		menu.appendChild(remove);
	}

	const extraItems = Array.isArray(opts.extraItems) ? opts.extraItems : [];
	for (const extra of extraItems) {
		const action = typeof extra?.action === 'string' ? extra.action.trim() : '';
		const label = typeof extra?.label === 'string' ? extra.label.trim() : '';
		if (!action || !label) continue;
		const item = document.createElement('button');
		item.type = 'button';
		item.className = 'feed-card-menu-item';
		item.setAttribute('role', 'menuitem');
		item.dataset.chatDmMenuAction = action;
		item.textContent = label;
		menu.appendChild(item);
	}

	document.body.appendChild(menu);
	menuEl = menu;

	const place = () => {
		const r = btn.getBoundingClientRect();
		const mw = menu.offsetWidth;
		const mh = menu.offsetHeight;
		let left = r.right - mw;
		if (left < 8) left = 8;
		if (left + mw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - mw - 8);
		let top = r.bottom + 4;
		if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
		menu.style.left = `${Math.round(left)}px`;
		menu.style.top = `${Math.round(top)}px`;
	};
	requestAnimationFrame(place);

	outsideHandler = (ev) => {
		if (!(ev.target instanceof Node)) return;
		if (menu.contains(ev.target)) return;
		if (btn.contains(ev.target)) return;
		closeDmSidebarGearMenu();
	};
	requestAnimationFrame(() => document.addEventListener('click', outsideHandler, true));

	escHandler = (ev) => {
		if (ev.key === 'Escape') {
			closeDmSidebarGearMenu();
		}
	};
	document.addEventListener('keydown', escHandler, true);

	menu.addEventListener('click', (ev) => {
		const item = ev.target?.closest?.('[data-chat-dm-menu-action]');
		if (!(item instanceof HTMLButtonElement)) return;
		ev.preventDefault();
		ev.stopPropagation();
		const act = item.getAttribute('data-chat-dm-menu-action');
		if (act === 'profile') {
			const href = item.getAttribute('data-chat-dm-menu-profile-href') || '/user';
			closeDmSidebarGearMenu();
			if (typeof opts.onViewProfile === 'function') {
				opts.onViewProfile(href);
				return;
			}
			const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
			const qs = v ? `?v=${encodeURIComponent(v)}` : '';
			void import(`/shared/spaPageOverlay.js${qs}`)
				.then((mod) => {
					mod.navigateToSpaPageFromSpa(href);
				})
				.catch(() => {
					window.location.assign(href);
				});
			return;
		}
		const key = item.getAttribute('data-chat-dm-menu-key') || pinKey;
		if (act === 'mark-read') {
			closeDmSidebarGearMenu();
			void Promise.resolve(opts.onMarkAsRead?.());
			return;
		}
		if (act === 'pin') {
			pinDmKey(key);
			closeDmSidebarGearMenu();
			try {
				opts.onAfterPinChange?.();
			} catch {
				// ignore
			}
			return;
		}
		if (act === 'unpin') {
			unpinDmKey(key);
			closeDmSidebarGearMenu();
			try {
				opts.onAfterPinChange?.();
			} catch {
				// ignore
			}
			return;
		}
		if (act === 'remove') {
			closeDmSidebarGearMenu();
			const dmTitle = dmTitleFromGearBtn(btn);
			openCloseDmConfirm({
				dmTitle,
				onConfirm: async () => {
					if (typeof opts.onRemove === 'function') {
						await opts.onRemove();
					}
					unpinDmKey(key);
				}
			});
			return;
		}
		if (typeof opts.onAction === 'function') {
			closeDmSidebarGearMenu();
			void Promise.resolve(opts.onAction(act || ''));
		}
	});
}
