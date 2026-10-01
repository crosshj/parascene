/**
 * Chat quick switcher (command palette): Slack-style overlay, Cmd/Ctrl+K on desktop.
 */

import { buildCommandPaletteItems, filterCommandPaletteItems } from './commandPaletteProvider.js';

const LISTBOX_ID = 'command-palette-listbox';
const MOBILE_MQ = '(max-width: 768px)';

function escapeHtml(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function isMacPlatform() {
	try {
		if (navigator.userAgentData?.platform) {
			return /mac/i.test(navigator.userAgentData.platform);
		}
	} catch {
		// ignore
	}
	return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '');
}

function isDesktopShortcutEnabled() {
	try {
		return !window.matchMedia(MOBILE_MQ).matches;
	} catch {
		return true;
	}
}

/**
 * @param {{
 *   getThreads?: () => unknown[],
 *   getJoinedServers?: () => unknown[],
 *   getViewerId?: () => number | null,
 *   navigateToPath?: (href: string) => void,
 *   isEnabled?: () => boolean,
 * }} options
 */
export function initCommandPalette(options = {}) {
	const getThreads = typeof options.getThreads === 'function' ? options.getThreads : () => [];
	const getJoinedServers = typeof options.getJoinedServers === 'function' ? options.getJoinedServers : () => [];
	const getViewerId = typeof options.getViewerId === 'function' ? options.getViewerId : () => null;
	const navigateToPath =
		typeof options.navigateToPath === 'function'
			? options.navigateToPath
			: (href) => {
					window.location.assign(href);
				};
	const isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => true;

	let overlay = null;
	let inputEl = null;
	let listEl = null;
	let clearBtn = null;
	let clearDivider = null;
	let footerShortcutEl = null;
	let isOpen = false;
	let selectedIndex = 0;
	let flatItems = [];
	let allItems = [];
	let query = '';
	let focusBeforeOpen = null;
	let rafPending = false;
	let keyboardNavActive = false;
	let openViaShortcut = false;

	const providerDeps = { getThreads, getJoinedServers, getViewerId };

	function ensureDom() {
		if (overlay && overlay.parentNode) return;
		overlay = document.createElement('div');
		overlay.className = 'command-palette-overlay';
		overlay.setAttribute('data-command-palette', '');
		overlay.innerHTML = `
			<div class="command-palette" role="dialog" aria-label="Quick switcher">
				<div class="command-palette-search-row">
					<span class="command-palette-search-icon" aria-hidden="true">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3-3"></path></svg>
					</span>
					<input type="text" class="command-palette-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Search channels, people, and places" aria-controls="${LISTBOX_ID}" aria-autocomplete="list" enterkeyhint="go" />
					<button type="button" class="command-palette-clear" hidden aria-label="Clear search">Clear</button>
					<span class="command-palette-search-divider" hidden aria-hidden="true"></span>
					<button type="button" class="command-palette-close" aria-label="Close quick switcher">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
					</button>
				</div>
				<div class="command-palette-body">
					<div class="command-palette-empty" hidden>Nothing matched that search. Try a channel name, person, or place.</div>
					<div class="command-palette-list-wrap">
						<div id="${LISTBOX_ID}" class="command-palette-list" role="listbox"></div>
					</div>
				</div>
				<div class="command-palette-footer">
					<span class="command-palette-footer-hints"><kbd>↑</kbd><kbd>↓</kbd> Select · <kbd>↵</kbd> Go · <kbd>esc</kbd> Close</span>
					<span class="command-palette-footer-shortcut"></span>
				</div>
			</div>`;
		document.body.appendChild(overlay);
		inputEl = overlay.querySelector('.command-palette-input');
		listEl = overlay.querySelector(`#${LISTBOX_ID}`);
		clearBtn = overlay.querySelector('.command-palette-clear');
		clearDivider = overlay.querySelector('.command-palette-search-divider');
		footerShortcutEl = overlay.querySelector('.command-palette-footer-shortcut');
		if (footerShortcutEl) {
			footerShortcutEl.textContent = isMacPlatform() ? '⌘K' : 'Ctrl+K';
		}
		overlay.querySelector('.command-palette-close')?.addEventListener('click', () => close());
		clearBtn?.addEventListener('click', () => {
			if (!(inputEl instanceof HTMLInputElement)) return;
			inputEl.value = '';
			query = '';
			keyboardNavActive = false;
			selectedIndex = flatItems.length > 0 ? 0 : -1;
			syncClearUi();
			scheduleRender();
			focusInput();
		});
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) close();
		});
		overlay.addEventListener('mousedown', (e) => {
			if (e.target === overlay) e.preventDefault();
		});
		inputEl?.addEventListener('input', () => {
			if (!(inputEl instanceof HTMLInputElement)) return;
			query = inputEl.value;
			keyboardNavActive = false;
			selectedIndex = 0;
			syncClearUi();
			scheduleRender();
		});
	}

	function syncClearUi() {
		const hasQuery = Boolean(String(query || '').trim());
		if (clearBtn instanceof HTMLButtonElement) clearBtn.hidden = !hasQuery;
		if (clearDivider instanceof HTMLElement) clearDivider.hidden = !hasQuery;
	}

	function setBodyModalLock(on) {
		try {
			document.body.classList.toggle('modal-open', Boolean(on));
		} catch {
			// ignore
		}
	}

	function rebuildItems() {
		allItems = buildCommandPaletteItems(providerDeps);
	}

	function scheduleRender() {
		if (rafPending) return;
		rafPending = true;
		requestAnimationFrame(() => {
			rafPending = false;
			renderList();
		});
	}

	function renderList() {
		if (!listEl || !inputEl) return;
		const view = filterCommandPaletteItems(allItems, query);
		flatItems = view.flatItems;
		if (selectedIndex >= flatItems.length) {
			selectedIndex = flatItems.length > 0 ? 0 : -1;
		}
		if (selectedIndex < 0 && flatItems.length > 0) selectedIndex = 0;

		const emptyEl = overlay?.querySelector('.command-palette-empty');
		const hasResults = flatItems.length > 0;
		if (emptyEl instanceof HTMLElement) {
			emptyEl.hidden = hasResults || !String(query || '').trim();
		}

		let html = '';
		let flatIdx = 0;
		for (const group of view.groups) {
			if (!group.items.length) continue;
			if (view.grouped && group.label) {
				html += `<div class="command-palette-section" role="presentation">${escapeHtml(group.label)}</div>`;
			}
			for (const item of group.items) {
				const selected = flatIdx === selectedIndex;
				const unread =
					Number(item.unreadCount) > 0
						? `<span class="command-palette-item-unread" aria-label="${Number(item.unreadCount)} unread">${escapeHtml(Number(item.unreadCount) > 99 ? '99+' : String(item.unreadCount))}</span>`
						: '';
				const enterHint = selected ? '<span class="command-palette-item-enter">Enter</span>' : '';
				const subtitle = item.subtitle
					? `<span class="command-palette-item-subtitle">${escapeHtml(item.subtitle)}</span>`
					: '';
				html += `<div class="command-palette-item${selected ? ' command-palette-item--selected' : ''}" role="option" id="command-palette-opt-${escapeHtml(item.id)}" data-flat-index="${flatIdx}" aria-selected="${selected ? 'true' : 'false'}">
					<span class="command-palette-item-icon">${item.iconHtml || ''}</span>
					<span class="command-palette-item-text">
						<span class="command-palette-item-title">${escapeHtml(item.title)}</span>
						${subtitle}
					</span>
					${unread}
					${enterHint}
				</div>`;
				flatIdx += 1;
			}
		}
		listEl.innerHTML = html;

		if (keyboardNavActive && selectedIndex >= 0 && flatItems[selectedIndex]) {
			inputEl.setAttribute('aria-activedescendant', `command-palette-opt-${flatItems[selectedIndex].id}`);
			const selectedNode = document.getElementById(`command-palette-opt-${flatItems[selectedIndex].id}`);
			if (selectedNode instanceof HTMLElement) {
				selectedNode.scrollIntoView({ block: 'nearest' });
			}
		} else {
			inputEl.removeAttribute('aria-activedescendant');
		}
	}

	function focusInput() {
		if (!(inputEl instanceof HTMLInputElement)) return;
		try {
			inputEl.focus({ preventScroll: true });
		} catch {
			inputEl.focus();
		}
		const len = inputEl.value.length;
		try {
			inputEl.setSelectionRange(len, len);
		} catch {
			// ignore
		}
	}

	function scheduleFocusInput() {
		focusInput();
		requestAnimationFrame(() => {
			focusInput();
			setTimeout(focusInput, 0);
			setTimeout(focusInput, 32);
		});
	}

	function open(fromShortcut = false) {
		if (isOpen || !isEnabled()) return;
		if (!isDesktopShortcutEnabled()) return;
		openViaShortcut = fromShortcut;
		ensureDom();
		focusBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		rebuildItems();
		query = '';
		keyboardNavActive = false;
		selectedIndex = 0;
		if (inputEl instanceof HTMLInputElement) inputEl.value = '';
		syncClearUi();
		isOpen = true;
		overlay.classList.add('open');
		setBodyModalLock(true);
		renderList();
		scheduleFocusInput();
		document.dispatchEvent(new CustomEvent('modal-opened'));
		setTimeout(focusInput, 64);
		openViaShortcut = false;
	}

	function close(options = {}) {
		if (!isOpen) return;
		const skipFocusRestore = options.skipFocusRestore === true;
		isOpen = false;
		keyboardNavActive = false;
		overlay?.classList.remove('open');
		setBodyModalLock(false);
		document.dispatchEvent(new CustomEvent('modal-closed'));
		if (inputEl) {
			inputEl.removeAttribute('aria-activedescendant');
		}
		const restore = focusBeforeOpen;
		focusBeforeOpen = null;
		if (
			!skipFocusRestore &&
			restore instanceof HTMLElement &&
			document.contains(restore)
		) {
			try {
				restore.focus({ preventScroll: true });
			} catch {
				// ignore
			}
		}
	}

	function selectItem(index) {
		const item = flatItems[index];
		if (!item?.href) return;
		close({ skipFocusRestore: true });
		navigateToPath(item.href);
	}

	function moveSelection(delta) {
		if (!flatItems.length) return;
		keyboardNavActive = true;
		if (selectedIndex < 0) {
			selectedIndex = 0;
		} else {
			selectedIndex = (selectedIndex + delta + flatItems.length) % flatItems.length;
		}
		renderList();
		focusInput();
	}

	function onDocumentKeydown(e) {
		if (!isDesktopShortcutEnabled()) return;

		const key = e.key;
		const mod = e.metaKey || e.ctrlKey;

		if (mod && key === 'k') {
			e.preventDefault();
			e.stopImmediatePropagation();
			if (isOpen) close();
			else setTimeout(() => open(true), 0);
			return;
		}

		if (!isOpen) return;

		if (key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
			return;
		}

		if (key === 'ArrowDown') {
			e.preventDefault();
			moveSelection(1);
			return;
		}
		if (key === 'ArrowUp') {
			e.preventDefault();
			moveSelection(-1);
			return;
		}
		if (key === 'Home') {
			e.preventDefault();
			keyboardNavActive = true;
			selectedIndex = flatItems.length > 0 ? 0 : -1;
			renderList();
			focusInput();
			return;
		}
		if (key === 'End') {
			e.preventDefault();
			keyboardNavActive = true;
			selectedIndex = flatItems.length > 0 ? flatItems.length - 1 : -1;
			renderList();
			focusInput();
			return;
		}
		if (key === 'Enter') {
			if (document.activeElement !== inputEl) return;
			e.preventDefault();
			if (selectedIndex >= 0) selectItem(selectedIndex);
		}
	}

	function onListClick(e) {
		const row = e.target?.closest?.('.command-palette-item');
		if (!(row instanceof HTMLElement)) return;
		const idx = Number(row.getAttribute('data-flat-index'));
		if (!Number.isFinite(idx)) return;
		selectItem(idx);
	}

	function onCloseAllModals() {
		if (isOpen) close();
	}

	document.addEventListener('keydown', onDocumentKeydown, true);
	document.addEventListener('close-all-modals', onCloseAllModals);

	ensureDom();
	listEl?.addEventListener('click', onListClick);

	return {
		open,
		close,
		isOpen: () => isOpen,
		destroy() {
			document.removeEventListener('keydown', onDocumentKeydown, true);
			document.removeEventListener('close-all-modals', onCloseAllModals);
			close();
			overlay?.remove();
			overlay = null;
		},
	};
}
