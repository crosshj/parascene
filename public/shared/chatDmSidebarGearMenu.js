import { isDmPinKeyActive, pinDmKey, unpinDmKey } from './chatDmPins.js';

let menuEl = null;
let outsideHandler = null;
let escHandler = null;

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
 * @param {{ onAfterPinChange?: () => void }} [opts]
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
	const pinned = isDmPinKeyActive(pinKey);

	const menu = document.createElement('div');
	menu.className = 'feed-card-menu chat-page-sidebar-dm-row-menu';
	menu.setAttribute('role', 'menu');
	menu.style.position = 'fixed';
	menu.style.zIndex = '100002';
	menu.style.boxSizing = 'border-box';

	const itemProfile = document.createElement('button');
	itemProfile.type = 'button';
	itemProfile.className = 'feed-card-menu-item';
	itemProfile.setAttribute('role', 'menuitem');
	itemProfile.dataset.chatDmMenuAction = 'profile';
	itemProfile.dataset.chatDmMenuProfileHref = profileHref;
	itemProfile.textContent = 'View Profile';
	menu.appendChild(itemProfile);

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
			window.location.assign(href);
			return;
		}
		const key = item.getAttribute('data-chat-dm-menu-key') || pinKey;
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
		}
	});
}
