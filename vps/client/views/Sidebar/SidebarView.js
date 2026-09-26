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
	</a>`).join('');
}

function rosterRowMarkup(item, kind) {
	const menuKey = kind === 'dm' ? 'dmRow' : kind === 'server' ? 'serverRow' : 'channelRow';
	const presenceClass = kind === 'dm' && !item.online ? ' is-offline' : '';
	return `<div class="sidebar-view__row${presenceClass}" data-sidebar-item="${escapeHtml(item.id)}">
		<a class="sidebar-view__row-link" href="${escapeHtml(item.path)}" data-spa-link>
			${avatarMarkup({ ...item, kind }, 'sidebar-view__row-avatar')}
			<span class="sidebar-view__row-label">${escapeHtml(item.label)}</span>
		</a>
		<button class="sidebar-view__row-menu" type="button" data-menu-key="${menuKey}" data-row-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.label)} options" aria-haspopup="menu" aria-expanded="false">${iconMarkup('more', 'sidebar-view__row-menu-icon')}</button>
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

export function mountSidebarView({ outlet, model, onAction }) {
	const root = mountTemplate(outlet, template);
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

	function syncRoute(pathname = location.pathname) {
		currentPath = pathname;
		for (const popup of popupMenus.values()) popup.close();
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

	function renderModel(nextModel) {
		const scrollTop = refs.scroll.scrollTop;
		const expanded = new Set([...root.querySelectorAll('[data-collapsible].is-expanded')].map((element) => element.dataset.collapsible));
		currentModel = nextModel;
		refs.menu.replaceChildren(htmlFragment(navigationMarkup(currentModel.navigation || [])));
		refs.directMessages.replaceChildren(htmlFragment(collapsibleRowsMarkup(currentModel.directMessages || [], 'dm', 'directMessages')));
		refs.servers.replaceChildren(htmlFragment(collapsibleRowsMarkup(currentModel.servers || [], 'server', 'servers')));
		refs.channels.replaceChildren(htmlFragment(collapsibleRowsMarkup(currentModel.channels || [], 'channel', 'channels')));
		refs.credits.textContent = currentModel.footer?.credits || '0';
		root.querySelectorAll('[data-icon]').forEach((element) => { element.innerHTML = iconMarkup(element.dataset.icon, 'sidebar-view__control-icon'); });
		for (const key of expanded) {
			const collapsible = root.querySelector(`[data-collapsible="${CSS.escape(key)}"]`);
			collapsible?.classList.add('is-expanded');
			const rest = collapsible?.querySelector('[data-collapsible-rest]');
			if (rest) rest.hidden = false;
		}
		routeItems = new Map();
		const allItems = [...(currentModel.navigation || []), ...(currentModel.directMessages || []), ...(currentModel.servers || []), ...(currentModel.channels || [])];
		for (const item of allItems) {
			const element = root.querySelector(`[data-sidebar-item="${CSS.escape(item.id)}"]`);
			if (element) routeItems.set(element, item);
		}
		setupPopupMenus();
		syncRoute(currentPath);
		requestAnimationFrame(() => {
			refs.scroll.scrollTop = scrollTop;
			syncScrollEdges();
		});
	}

	function onRootClick(event) {
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
