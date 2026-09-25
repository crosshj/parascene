import { bindRefs, escapeHtml, htmlFragment, mountTemplate } from '../../utils/dom.js';
import template from './LayoutView.html';
import './LayoutView.css';

function menuMarkup(items, mobile = false) {
	const className = mobile ? 'beta-layout__mobile-item' : 'beta-layout__menu-item';
	return items.map(({ label, path }) => {
		const icon = mobile ? '' : `<span class="beta-layout__mock-avatar" aria-hidden="true">${escapeHtml(label.slice(0, 1).toUpperCase())}</span>`;
		return `<a class="${className}" href="${escapeHtml(path)}" data-spa-link>${icon}<span class="beta-layout__mock-label">${escapeHtml(label)}</span></a>`;
	}).join('');
}

function mockRows(labels) {
	return labels.map((label) => `<div class="beta-layout__mock-row" aria-hidden="true"><span class="beta-layout__mock-avatar">${escapeHtml(label.slice(0, 1).toUpperCase())}</span><span class="beta-layout__mock-label">${escapeHtml(label)}</span></div>`).join('');
}

export function mountLayout({ shell, outlet, menuItems, accountElement, logoutButton }) {
	const root = mountTemplate(shell, template);
	const refs = bindRefs(root);
	const minWidth = 220;
	const maxWidth = 460;
	const defaultWidth = 272;
	const clampWidth = (value) => Math.min(maxWidth, Math.max(minWidth, Number(value) || defaultWidth));
	let sidebarWidth = defaultWidth;
	try { sidebarWidth = clampWidth(localStorage.getItem('prsn-chat-sidebar-width-px')); } catch { /* Storage may be unavailable. */ }
	const setSidebarWidth = (value, persist = true) => {
		sidebarWidth = clampWidth(value);
		root.style.setProperty('--beta-sidebar-width', `${sidebarWidth}px`);
		document.body.style.setProperty('--beta-sidebar-width', `${sidebarWidth}px`);
		if (persist) {
			try { localStorage.setItem('prsn-chat-sidebar-width-px', String(sidebarWidth)); } catch { /* Ignore storage failures. */ }
		}
	};
	setSidebarWidth(sidebarWidth, false);
	root.style.setProperty('--beta-menu-count', Math.max(1, menuItems.length));
	refs.desktopMenu.append(htmlFragment(menuMarkup(menuItems)));
	refs.mobileMenu.append(htmlFragment(menuMarkup(menuItems, true)));
	refs.directMessages.append(htmlFragment(mockRows(['Ari', 'Mina', 'Jon'])));
	refs.servers.append(htmlFragment(mockRows(['Parascene', 'Prompt club'])));
	refs.channels.append(htmlFragment(mockRows(['General', 'Introductions', 'Showcase'])));
	if (accountElement) {
		accountElement.className = 'beta-layout__account-label';
		refs.account.replaceWith(accountElement);
	}
	if (logoutButton) {
		logoutButton.className = 'beta-layout__footer-action beta-layout__logout';
		refs.logout.replaceWith(logoutButton);
	}
	let resizing = false;
	const stopResize = () => {
		if (!resizing) return;
		resizing = false;
		refs.resizeHandle.removeAttribute('aria-valuenow');
	};
	refs.resizeHandle.addEventListener('pointerdown', (event) => {
		if (event.button !== 0) return;
		resizing = true;
		refs.resizeHandle.setPointerCapture?.(event.pointerId);
		event.preventDefault();
	});
	refs.resizeHandle.addEventListener('pointermove', (event) => {
		if (!resizing) return;
		setSidebarWidth(event.clientX);
	});
	refs.resizeHandle.addEventListener('pointerup', stopResize);
	refs.resizeHandle.addEventListener('pointercancel', stopResize);
	refs.resizeHandle.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			setSidebarWidth(sidebarWidth + (event.key === 'ArrowRight' ? 8 : -8));
		}
		if (event.key === 'Home') { event.preventDefault(); setSidebarWidth(minWidth); }
		if (event.key === 'End') { event.preventDefault(); setSidebarWidth(maxWidth); }
	});
	document.body.classList.add('beta-layout');
	return {
		root,
		outlet,
		accountElement,
		avatarElement: refs.avatar,
		avatarInitial: refs.avatarInitial,
		avatarImage: refs.avatarImage,
		logoutButton
	};
}
