import { avatarMarkup } from '../../components/Avatar/Avatar.js';
import { iconMarkup } from '../../components/Icon/Icon.js';
import { createPopupMenu } from '../../components/PopupMenu/PopupMenu.js';
import { bindRefs, escapeHtml, htmlFragment, mountTemplate } from '../../utils/dom.js';
import { isSidebarRouteActive } from '../../utils/sidebarRoutes.js';
import template from './SidebarView.html';
import './SidebarView.css';

const COLLAPSED_ROW_COUNT = 5;

function navigationMarkup(items) {
	return items.map((item) => `<a class="sidebar-view__menu-item" href="${escapeHtml(item.path)}" data-spa-link data-sidebar-item="${escapeHtml(item.id)}">
		<span class="sidebar-view__route-icon" aria-hidden="true">${iconMarkup(item.icon, 'sidebar-view__route-icon-svg')}</span>
		<span class="sidebar-view__row-label">${escapeHtml(item.label)}</span>
		${Number(item.unread) > 0 ? `<span class="sidebar-view__nav-badge-slot"><span class="sidebar-view__unread" aria-label="${Number(item.unread)} unread">${Number(item.unread) > 99 ? '99+' : Number(item.unread)}</span></span>` : ''}
	</a>`).join('');
}

function rosterRowMarkup(item, kind) {
	const menuKey = kind === 'dm' ? 'dmRow' : kind === 'server' ? 'serverRow' : 'channelRow';
	const presenceClass = kind === 'dm' && !item.online ? ' is-offline' : '';
	const unread = Number(item.unread) || 0;
	const unreadClass = unread > 0 ? ' has-unread' : '';
	return `<div class="sidebar-view__row${presenceClass}${unreadClass}" data-sidebar-item="${escapeHtml(item.id)}">
		<a class="sidebar-view__row-link" href="${escapeHtml(item.path)}" data-spa-link>
			${avatarMarkup({ ...item, kind }, 'sidebar-view__row-avatar')}
			<span class="sidebar-view__row-body"><span class="sidebar-view__row-title-line">
				<span class="sidebar-view__row-label">${escapeHtml(item.label)}</span>
			</span></span>
		</a>
		<span class="sidebar-view__row-controls">
			<button class="sidebar-view__row-menu" type="button" data-menu-key="${menuKey}" data-row-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.label)} options" aria-haspopup="menu" aria-expanded="false">${iconMarkup('gear', 'sidebar-view__row-menu-icon')}</button>
			<span class="sidebar-view__badge-slot">${unread > 0 ? `<span class="sidebar-view__unread" aria-label="${unread} unread">${unread > 99 ? '99+' : unread}</span>` : ''}</span>
		</span>
	</div>`;
}

function collapsibleRowsMarkup(items, kind, sectionKey) {
	const visible = items.slice(0, COLLAPSED_ROW_COUNT).map((item) => rosterRowMarkup(item, kind)).join('');
	if (items.length <= COLLAPSED_ROW_COUNT) return visible;
	const rest = items.slice(COLLAPSED_ROW_COUNT).map((item) => rosterRowMarkup(item, kind)).join('');
	return `<div class="sidebar-view__collapsible" data-collapsible="${escapeHtml(sectionKey)}">
		<div>${visible}</div>
		<div class="sidebar-view__expander-wrap sidebar-view__expander-wrap--more">
			<button class="sidebar-view__expander" type="button" data-expand="more" aria-expanded="false">Show more</button>
		</div>
		<div class="sidebar-view__collapsible-rest" data-collapsible-rest hidden>${rest}
			<div class="sidebar-view__expander-wrap">
				<button class="sidebar-view__expander" type="button" data-expand="less" aria-expanded="true">Show less</button>
			</div>
		</div>
	</div>`;
}

function patchRosterRow(current, next) {
	const activeClass = current.classList.contains('is-active');
	const nextClassName = `${next.className}${activeClass ? ' is-active' : ''}`;
	if (current.className !== nextClassName) current.className = nextClassName;
	if (current.dataset.sidebarItem !== next.dataset.sidebarItem) current.dataset.sidebarItem = next.dataset.sidebarItem;
	const liveLink = current.querySelector('.sidebar-view__row-link');
	const nextLink = next.querySelector('.sidebar-view__row-link');
	if (liveLink.getAttribute('href') !== nextLink.getAttribute('href')) liveLink.setAttribute('href', nextLink.getAttribute('href'));
	const liveLabel = current.querySelector('.sidebar-view__row-label');
	const nextLabel = next.querySelector('.sidebar-view__row-label')?.textContent || '';
	if (liveLabel.textContent !== nextLabel) liveLabel.textContent = nextLabel;
	const liveUnread = current.querySelector('.sidebar-view__unread');
	const nextUnread = next.querySelector('.sidebar-view__unread');
	if (!nextUnread) liveUnread?.remove();
	else if (liveUnread) {
		if (liveUnread.textContent !== nextUnread.textContent) liveUnread.textContent = nextUnread.textContent;
		if (liveUnread.getAttribute('aria-label') !== nextUnread.getAttribute('aria-label')) liveUnread.setAttribute('aria-label', nextUnread.getAttribute('aria-label') || 'Unread');
	} else current.querySelector('.sidebar-view__badge-slot')?.append(nextUnread.cloneNode(true));
	const liveAvatar = current.querySelector('.ps-avatar');
	const nextAvatar = next.querySelector('.ps-avatar');
	if (liveAvatar && nextAvatar) {
		if (liveAvatar.className !== nextAvatar.className) liveAvatar.className = nextAvatar.className;
		if (liveAvatar.style.cssText !== nextAvatar.style.cssText) liveAvatar.style.cssText = nextAvatar.style.cssText;
		if (liveAvatar.getAttribute('aria-label') !== nextAvatar.getAttribute('aria-label')) liveAvatar.setAttribute('aria-label', nextAvatar.getAttribute('aria-label') || '');
		const liveImage = liveAvatar.querySelector('img');
		const nextImage = nextAvatar.querySelector('img');
		if (nextImage && liveImage) {
			if (liveImage.getAttribute('src') !== nextImage.getAttribute('src')) liveImage.setAttribute('src', nextImage.getAttribute('src'));
		} else if (nextImage || liveImage) liveAvatar.replaceChildren(...[...nextAvatar.childNodes].map((node) => node.cloneNode(true)));
		else if (liveAvatar.textContent !== nextAvatar.textContent) liveAvatar.textContent = nextAvatar.textContent;
	}
	const liveButton = current.querySelector('.sidebar-view__row-menu');
	const nextButton = next.querySelector('.sidebar-view__row-menu');
	if (liveButton.dataset.menuKey !== nextButton.dataset.menuKey) liveButton.dataset.menuKey = nextButton.dataset.menuKey;
	if (liveButton.dataset.rowId !== nextButton.dataset.rowId) liveButton.dataset.rowId = nextButton.dataset.rowId;
	if (liveButton.getAttribute('aria-label') !== nextButton.getAttribute('aria-label')) liveButton.setAttribute('aria-label', nextButton.getAttribute('aria-label') || 'Options');
	return current;
}

export function mountSidebarView({ outlet, model, onAction }) {
	const root = mountTemplate(outlet, template);
	// Template icon slots are intentional so static sidebar markup stays readable;
	// replace them with the shared SVG icon system as soon as the view mounts.
	for (const placeholder of root.querySelectorAll('[data-icon]')) {
		placeholder.outerHTML = iconMarkup(placeholder.dataset.icon, 'sidebar-view__control-icon');
	}
	const refs = bindRefs(root);
	const minWidth = 220;
	const maxWidth = 460;
	const defaultWidth = 272;
	const clampWidth = (value) => Math.min(maxWidth, Math.max(minWidth, Number(value) || defaultWidth));
	let sidebarWidth = defaultWidth;
	let resizing = false;
	let pointerOffset = 0;
	let panelLeft = 0;
	let pendingWidth = defaultWidth;
	let resizeFrame = 0;
	let currentModel = model;
	let currentPath = location.pathname;
	let routeItems = new Map();
	let popupMenus = new Map();
	let activeMenuRow = null;
	let footerResizeObserver = null;

	try { sidebarWidth = clampWidth(localStorage.getItem('prsn-chat-sidebar-width-px')); } catch { /* Storage may be unavailable. */ }

	function setSidebarWidth(value, { persist = true, announce = true } = {}) {
		sidebarWidth = clampWidth(value);
		document.body.style.setProperty('--beta-sidebar-width', `${sidebarWidth}px`);
		if (announce) refs.resizeHandle.setAttribute('aria-valuenow', String(sidebarWidth));
		if (persist) {
			try { localStorage.setItem('prsn-chat-sidebar-width-px', String(sidebarWidth)); } catch { /* Ignore storage failures. */ }
		}
	}

	function flushPendingWidth({ persist = false, announce = false } = {}) {
		if (resizeFrame) {
			cancelAnimationFrame(resizeFrame);
			resizeFrame = 0;
		}
		setSidebarWidth(pendingWidth, { persist, announce });
	}

	function schedulePendingWidth() {
		if (resizeFrame) return;
		resizeFrame = requestAnimationFrame(() => {
			resizeFrame = 0;
			setSidebarWidth(pendingWidth, { persist: false, announce: false });
		});
	}

	function stopResize(event) {
		if (!resizing) return;
		if (event?.type === 'pointerup' && Number.isFinite(event.clientX)) pendingWidth = event.clientX - panelLeft - pointerOffset;
		flushPendingWidth({ persist: true, announce: true });
		resizing = false;
		refs.resizeHandle.classList.remove('is-resizing');
		document.body.classList.remove('is-resizing-sidebar');
	}

	function onPointerDown(event) {
		if (event.button !== 0) return;
		const panelBounds = refs.panel.getBoundingClientRect();
		resizing = true;
		panelLeft = panelBounds.left;
		pointerOffset = event.clientX - panelBounds.right;
		pendingWidth = sidebarWidth;
		refs.resizeHandle.classList.add('is-resizing');
		document.body.classList.add('is-resizing-sidebar');
		refs.resizeHandle.setPointerCapture?.(event.pointerId);
		event.preventDefault();
	}

	function onPointerMove(event) {
		if (!resizing) return;
		pendingWidth = event.clientX - panelLeft - pointerOffset;
		schedulePendingWidth();
	}

	function onKeyDown(event) {
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			setSidebarWidth(sidebarWidth + (event.key === 'ArrowRight' ? 8 : -8));
		}
		if (event.key === 'Home') { event.preventDefault(); setSidebarWidth(minWidth); }
		if (event.key === 'End') { event.preventDefault(); setSidebarWidth(maxWidth); }
	}

	function syncRoute(pathname = location.pathname, { closeMenus = true } = {}) {
		currentPath = pathname;
		if (closeMenus) for (const popup of popupMenus.values()) popup.close();
		for (const [element, item] of routeItems) {
			const active = isSidebarRouteActive(item, currentPath);
			element.classList.toggle('is-active', active);
			const link = element.matches('a') ? element : element.querySelector('a[data-spa-link]');
			if (active) link?.setAttribute('aria-current', 'page');
			else link?.removeAttribute('aria-current');
		}
	}

	function syncScrollEdges() {
		const hasScrollAbove = refs.scroll.scrollTop > 1;
		const hasScrollBelow = refs.scroll.scrollTop + refs.scroll.clientHeight < refs.scroll.scrollHeight - 1;
		refs.panel.classList.toggle('has-scroll-above', hasScrollAbove);
		refs.panel.classList.toggle('has-scroll-below', hasScrollBelow);
		refs.panel.classList.add('scroll-state-ready');
	}

	function syncFooterHeight() {
		const height = Math.ceil(refs.footer.getBoundingClientRect().height);
		refs.panel.style.setProperty('--sidebar-footer-height', `${height}px`);
		syncScrollEdges();
	}

	function destroyPopupMenus() {
		for (const popup of popupMenus.values()) popup.destroy();
		popupMenus = new Map();
	}

	function setupPopupMenus() {
		destroyPopupMenus();
		for (const [key, definition] of Object.entries(currentModel.menus || {})) {
			if (['account', 'notifications', 'credits'].includes(key)) continue;
			popupMenus.set(key, createPopupMenu({
				...definition,
				onSelect(item) {
					if (item?.action === 'logout') refs.logout.click();
					else onAction?.({ action: item?.action, menu: key, row: activeMenuRow });
				}
			}));
		}
	}

	function reconcileRows(host, items, kind, existingRows) {
		const desired = [];
		for (const item of items) {
			const templateRow = htmlFragment(rosterRowMarkup(item, kind)).firstElementChild;
			const prior = existingRows.get(item.id);
			desired.push(prior ? patchRosterRow(prior, templateRow) : templateRow);
			existingRows.delete(item.id);
		}
		for (let index = 0; index < desired.length; index++) {
			const current = host.children[index];
			if (current !== desired[index]) host.insertBefore(desired[index], current || null);
		}
		for (const child of [...host.children].slice(desired.length)) child.remove();
	}

	function closeMenuForRemovedRow(existingRows) {
		if (!activeMenuRow || !existingRows.has(activeMenuRow)) return;
		const oldRow = existingRows.get(activeMenuRow);
		const menuKey = oldRow.querySelector('[data-menu-key]')?.dataset.menuKey;
		popupMenus.get(menuKey)?.close();
		activeMenuRow = null;
	}

	function renderRosterSection(container, items, kind, sectionKey) {
		const existingRows = new Map([...container.querySelectorAll('[data-sidebar-item]')].map((row) => [row.dataset.sidebarItem, row]));
		if (items.length <= COLLAPSED_ROW_COUNT) {
			if (container.querySelector('[data-collapsible]')) {
				const host = document.createElement('div');
				container.replaceChildren(host);
				reconcileRows(host, items, kind, existingRows);
			} else reconcileRows(container, items, kind, existingRows);
			closeMenuForRemovedRow(existingRows);
			return;
		}
		let collapsible = container.querySelector('[data-collapsible]');
		if (!collapsible) {
			container.innerHTML = `<div class="sidebar-view__collapsible" data-collapsible="${escapeHtml(sectionKey)}"><div data-row-host="top"></div><div class="sidebar-view__expander-wrap sidebar-view__expander-wrap--more"><button class="sidebar-view__expander" type="button" data-expand="more" aria-expanded="false">Show more</button></div><div class="sidebar-view__collapsible-rest" data-collapsible-rest hidden><div data-row-host="rest"></div><div class="sidebar-view__expander-wrap"><button class="sidebar-view__expander" type="button" data-expand="less" aria-expanded="true">Show less</button></div></div></div>`;
			collapsible = container.querySelector('[data-collapsible]');
		}
		const expanded = collapsible.classList.contains('is-expanded');
		const rest = collapsible.querySelector('[data-collapsible-rest]');
		rest.hidden = !expanded;
		const moreButton = collapsible.querySelector('[data-expand="more"]');
		if (moreButton) moreButton.setAttribute('aria-expanded', String(expanded));
		const lessButton = collapsible.querySelector('[data-expand="less"]');
		if (lessButton) lessButton.setAttribute('aria-expanded', String(expanded));
		reconcileRows(collapsible.querySelector('[data-row-host="top"]'), items.slice(0, COLLAPSED_ROW_COUNT), kind, existingRows);
		reconcileRows(collapsible.querySelector('[data-row-host="rest"]'), items.slice(COLLAPSED_ROW_COUNT), kind, existingRows);
		closeMenuForRemovedRow(existingRows);
	}

	function renderModel(nextModel) {
		const priorMenuRow = activeMenuRow ? root.querySelector(`[data-sidebar-item="${CSS.escape(activeMenuRow)}"]`) : null;
		const priorMenuHost = priorMenuRow?.parentElement;
		const priorMenuIndex = priorMenuHost ? [...priorMenuHost.children].indexOf(priorMenuRow) : -1;
		currentModel = nextModel;
		const navItems = currentModel.navigation || [];
		const oldNav = new Map([...refs.menu.children].map((item) => [item.dataset.sidebarItem, item]));
		const navNodes = navItems.map((item) => {
			const fresh = htmlFragment(navigationMarkup([item])).firstElementChild;
			const old = oldNav.get(item.id);
			oldNav.delete(item.id);
			if (!old) return fresh;
			if (old.getAttribute('href') !== fresh.getAttribute('href')) old.setAttribute('href', fresh.getAttribute('href'));
			const oldLabel = old.querySelector('.sidebar-view__row-label');
			if (oldLabel.textContent !== item.label) oldLabel.textContent = item.label;
			const liveUnread = old.querySelector('.sidebar-view__unread');
			const nextUnread = fresh.querySelector('.sidebar-view__unread');
			const liveBadgeSlot = old.querySelector('.sidebar-view__nav-badge-slot');
			const nextBadgeSlot = fresh.querySelector('.sidebar-view__nav-badge-slot');
			if (!nextUnread) liveBadgeSlot?.remove();
			else if (liveUnread) {
				if (liveUnread.textContent !== nextUnread.textContent) liveUnread.textContent = nextUnread.textContent;
				if (liveUnread.getAttribute('aria-label') !== nextUnread.getAttribute('aria-label')) liveUnread.setAttribute('aria-label', nextUnread.getAttribute('aria-label') || 'Unread');
			}
			else if (nextBadgeSlot) old.append(nextBadgeSlot.cloneNode(true));
			return old;
		});
		for (let index = 0; index < navNodes.length; index++) if (refs.menu.children[index] !== navNodes[index]) refs.menu.insertBefore(navNodes[index], refs.menu.children[index] || null);
		for (const old of oldNav.values()) old.remove();
		renderRosterSection(refs.directMessages, currentModel.directMessages || [], 'dm', 'directMessages');
		renderRosterSection(refs.servers, currentModel.servers || [], 'server', 'servers');
		renderRosterSection(refs.channels, currentModel.channels || [], 'channel', 'channels');
		const creditsText = String(currentModel.footer?.credits ?? '…');
		if (refs.credits.textContent !== creditsText) refs.credits.textContent = creditsText;
		routeItems = new Map();
		const allItems = [...(currentModel.navigation || []), ...(currentModel.directMessages || []), ...(currentModel.servers || []), ...(currentModel.channels || [])];
		for (const item of allItems) {
			const element = root.querySelector(`[data-sidebar-item="${CSS.escape(item.id)}"]`);
			if (element) routeItems.set(element, item);
		}
		if (activeMenuRow) {
			const nextMenuRow = root.querySelector(`[data-sidebar-item="${CSS.escape(activeMenuRow)}"]`);
			const nextHost = nextMenuRow?.parentElement;
			const nextIndex = nextHost ? [...nextHost.children].indexOf(nextMenuRow) : -1;
			if (!nextMenuRow || priorMenuHost !== nextHost || priorMenuIndex !== nextIndex) {
				const menuKey = priorMenuRow?.querySelector('[data-menu-key]')?.dataset.menuKey;
				popupMenus.get(menuKey)?.close();
				activeMenuRow = null;
			}
		}
		syncRoute(currentPath, { closeMenus: false });
		syncScrollEdges();
	}

	let rosterStatusName = 'idle';
	let rosterStatusTimer = 0;
	function setRosterStatus(snapshot) {
		const status = refs.rosterStatus;
		rosterStatusName = snapshot?.status || 'idle';
		if (snapshot?.data || rosterStatusName === 'ready' || rosterStatusName === 'refreshing') {
			window.clearTimeout(rosterStatusTimer);
			status.hidden = true;
			return;
		}
		if (rosterStatusName === 'loading') {
			status.hidden = true;
			window.clearTimeout(rosterStatusTimer);
			rosterStatusTimer = window.setTimeout(() => {
				if (rosterStatusName === 'loading') {
					status.textContent = 'Updating sidebar…';
					status.hidden = false;
				}
			}, 250);
			return;
		}
		window.clearTimeout(rosterStatusTimer);
		if (rosterStatusName === 'error') {
			status.replaceChildren(document.createTextNode('Could not load sidebar items.'));
			const retry = document.createElement('button');
			retry.type = 'button';
			retry.dataset.sidebarRetry = '1';
			retry.textContent = 'Retry';
			status.append(retry);
			status.hidden = false;
		}
	}

	function onRootClick(event) {
		const retry = event.target.closest('[data-sidebar-retry]');
		if (retry) { onAction?.({ action: 'refresh-sidebar' }); return; }
		const expandButton = event.target.closest('[data-expand]');
		if (expandButton) {
			const collapsible = expandButton.closest('[data-collapsible]');
			const rest = collapsible?.querySelector('[data-collapsible-rest]');
			const shouldExpand = expandButton.dataset.expand === 'more';
			if (rest) rest.hidden = !shouldExpand;
			collapsible?.classList.toggle('is-expanded', shouldExpand);
			collapsible?.querySelectorAll('[data-expand]').forEach((button) => button.setAttribute('aria-expanded', String(shouldExpand)));
			if (!shouldExpand) collapsible?.scrollIntoView({ block: 'nearest' });
			return;
		}
		const menuButton = event.target.closest('[data-menu-key]');
		if (menuButton) {
			event.preventDefault();
			event.stopPropagation();
			if (['account', 'notifications', 'credits'].includes(menuButton.dataset.menuKey)) {
				onAction?.({ action: 'open-overlay', overlay: menuButton.dataset.menuKey, anchor: menuButton });
				return;
			}
			activeMenuRow = menuButton.dataset.rowId || null;
			for (const [key, popup] of popupMenus) {
				if (key !== menuButton.dataset.menuKey) popup.close();
			}
			popupMenus.get(menuButton.dataset.menuKey)?.toggle(menuButton);
			return;
		}
		const link = event.target.closest('a[data-spa-link]');
		if (link) syncRoute(new URL(link.href, location.href).pathname);
	}

	setSidebarWidth(sidebarWidth, { persist: false });
	setupPopupMenus();
	renderModel(currentModel);
	refs.resizeHandle.addEventListener('pointerdown', onPointerDown);
	refs.resizeHandle.addEventListener('pointermove', onPointerMove);
	refs.resizeHandle.addEventListener('pointerup', stopResize);
	refs.resizeHandle.addEventListener('pointercancel', stopResize);
	refs.resizeHandle.addEventListener('keydown', onKeyDown);
	refs.scroll.addEventListener('scroll', syncScrollEdges, { passive: true });
	root.addEventListener('click', onRootClick);
	footerResizeObserver = new ResizeObserver(syncFooterHeight);
	footerResizeObserver.observe(refs.footer);
	// Set the initial fade/edge state before first paint so overflowing items
	// don't flash unobscured while waiting for the next animation frame.
	syncFooterHeight();

	return {
		root,
		accountElement: refs.account,
		avatarElement: refs.avatar,
		avatarInitial: refs.avatarInitial,
		avatarImage: refs.avatarImage,
		logoutButton: refs.logout,
		syncRoute,
		update: renderModel,
		setRosterStatus,
		updateCredits(value) {
			const next = Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : '0';
			if (refs.credits.textContent !== next) refs.credits.textContent = next;
		},
		destroy() {
			if (resizeFrame) cancelAnimationFrame(resizeFrame);
			footerResizeObserver?.disconnect();
			destroyPopupMenus();
			document.body.classList.remove('is-resizing-sidebar');
			refs.resizeHandle.removeEventListener('pointerdown', onPointerDown);
			refs.resizeHandle.removeEventListener('pointermove', onPointerMove);
			refs.resizeHandle.removeEventListener('pointerup', stopResize);
			refs.resizeHandle.removeEventListener('pointercancel', stopResize);
			refs.resizeHandle.removeEventListener('keydown', onKeyDown);
			refs.scroll.removeEventListener('scroll', syncScrollEdges);
			root.removeEventListener('click', onRootClick);
			root.remove();
		}
	};
}
