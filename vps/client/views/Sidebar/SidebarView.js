import { bindRefs, escapeHtml, htmlFragment, mountTemplate } from '../../utils/dom.js';
import template from './SidebarView.html';
import './SidebarView.css';

function navigationMarkup(items) {
	return items.map(({ label, path }) => {
		const initial = escapeHtml(label.slice(0, 1).toUpperCase());
		return `<a class="sidebar-view__menu-item" href="${escapeHtml(path)}" data-spa-link><span class="sidebar-view__mock-avatar" aria-hidden="true">${initial}</span><span class="sidebar-view__mock-label">${escapeHtml(label)}</span></a>`;
	}).join('');
}

function mockRows(labels) {
	return labels.map((label) => `<div class="sidebar-view__mock-row" aria-hidden="true"><span class="sidebar-view__mock-avatar">${escapeHtml(label.slice(0, 1).toUpperCase())}</span><span class="sidebar-view__mock-label">${escapeHtml(label)}</span></div>`).join('');
}

export function mountSidebarView({ outlet, navigationItems }) {
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

	setSidebarWidth(sidebarWidth, { persist: false });
	refs.menu.append(htmlFragment(navigationMarkup(navigationItems)));
	refs.directMessages.append(htmlFragment(mockRows(['Ari', 'Mina', 'Jon'])));
	refs.servers.append(htmlFragment(mockRows(['Parascene', 'Prompt club'])));
	refs.channels.append(htmlFragment(mockRows(['General', 'Introductions', 'Showcase'])));

	refs.resizeHandle.addEventListener('pointerdown', onPointerDown);
	refs.resizeHandle.addEventListener('pointermove', onPointerMove);
	refs.resizeHandle.addEventListener('pointerup', stopResize);
	refs.resizeHandle.addEventListener('pointercancel', stopResize);
	refs.resizeHandle.addEventListener('keydown', onKeyDown);

	return {
		root,
		accountElement: refs.account,
		avatarElement: refs.avatar,
		avatarInitial: refs.avatarInitial,
		avatarImage: refs.avatarImage,
		logoutButton: refs.logout,
		destroy() {
		if (resizeFrame) cancelAnimationFrame(resizeFrame);
		document.body.classList.remove('is-resizing-sidebar');
			refs.resizeHandle.removeEventListener('pointerdown', onPointerDown);
			refs.resizeHandle.removeEventListener('pointermove', onPointerMove);
			refs.resizeHandle.removeEventListener('pointerup', stopResize);
			refs.resizeHandle.removeEventListener('pointercancel', stopResize);
			refs.resizeHandle.removeEventListener('keydown', onKeyDown);
			root.remove();
		}
	};
}
