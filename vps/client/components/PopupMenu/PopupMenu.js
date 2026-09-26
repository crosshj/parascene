import { escapeHtml, htmlFragment } from '../../utils/dom.js';
import { iconMarkup } from '../Icon/Icon.js';
import './PopupMenu.css';

function itemMarkup(item, index) {
	if (item?.separator) return '<div class="ps-popup-menu__divider" role="separator"></div>';
	const icon = item.icon ? iconMarkup(item.icon, 'ps-popup-menu__icon') : '';
	const classes = `ps-popup-menu__item${item.danger ? ' ps-popup-menu__item--danger' : ''}`;
	const attrs = `class="${classes}" data-popup-menu-index="${index}" role="menuitem" tabindex="-1"`;
	if (item.href) return `<a ${attrs} href="${escapeHtml(item.href)}" data-spa-link>${icon}<span>${escapeHtml(item.label)}</span></a>`;
	return `<button type="button" ${attrs}>${icon}<span>${escapeHtml(item.label)}</span></button>`;
}

export function createPopupMenu({ label = '', items = [], onSelect } = {}) {
	const menu = document.createElement('div');
	menu.className = 'ps-popup-menu';
	menu.setAttribute('role', 'menu');
	menu.setAttribute('aria-label', label || 'Menu');
	menu.hidden = true;
	if (label) menu.append(htmlFragment(`<p class="ps-popup-menu__label">${escapeHtml(label)}</p>`));
	menu.append(htmlFragment(items.map(itemMarkup).join('')));
	document.body.append(menu);
	let anchor = null;

	function position() {
		if (!anchor || menu.hidden) return;
		const gap = 6;
		const inset = 8;
		const anchorRect = anchor.getBoundingClientRect();
		const menuRect = menu.getBoundingClientRect();
		let left = anchorRect.right + gap;
		if (left + menuRect.width > innerWidth - inset) left = anchorRect.left - menuRect.width - gap;
		left = Math.max(inset, Math.min(left, innerWidth - menuRect.width - inset));
		let top = anchorRect.top;
		if (top + menuRect.height > innerHeight - inset) top = anchorRect.bottom - menuRect.height;
		top = Math.max(inset, Math.min(top, innerHeight - menuRect.height - inset));
		menu.style.left = `${Math.round(left)}px`;
		menu.style.top = `${Math.round(top)}px`;
	}

	function close({ restoreFocus = false } = {}) {
		if (menu.hidden) return;
		menu.hidden = true;
		anchor?.setAttribute('aria-expanded', 'false');
		if (restoreFocus) anchor?.focus();
		anchor = null;
	}

	function open(nextAnchor) {
		if (!(nextAnchor instanceof HTMLElement)) return;
		anchor?.setAttribute('aria-expanded', 'false');
		anchor = nextAnchor;
		anchor.setAttribute('aria-expanded', 'true');
		menu.hidden = false;
		position();
		menu.querySelector('[role="menuitem"]')?.focus();
	}

	function toggle(nextAnchor) {
		if (!menu.hidden && anchor === nextAnchor) close({ restoreFocus: true });
		else open(nextAnchor);
	}

	function onMenuClick(event) {
		const target = event.target.closest('[data-popup-menu-index]');
		if (!target) return;
		const item = items[Number(target.dataset.popupMenuIndex)];
		close();
		if (!item?.href) onSelect?.(item);
	}

	function onDocumentPointerDown(event) {
		if (menu.hidden || menu.contains(event.target) || anchor?.contains(event.target)) return;
		close();
	}

	function onDocumentKeyDown(event) {
		if (menu.hidden) return;
		if (event.key === 'Escape') { event.preventDefault(); close({ restoreFocus: true }); return; }
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const entries = [...menu.querySelectorAll('[role="menuitem"]')];
		if (!entries.length) return;
		event.preventDefault();
		const current = entries.indexOf(document.activeElement);
		const delta = event.key === 'ArrowDown' ? 1 : -1;
		entries[(current + delta + entries.length) % entries.length].focus();
	}

	menu.addEventListener('click', onMenuClick);
	document.addEventListener('pointerdown', onDocumentPointerDown, true);
	document.addEventListener('keydown', onDocumentKeyDown);
	window.addEventListener('resize', position);
	window.addEventListener('scroll', position, true);

	return {
		open,
		toggle,
		close,
		destroy() {
			menu.removeEventListener('click', onMenuClick);
			document.removeEventListener('pointerdown', onDocumentPointerDown, true);
			document.removeEventListener('keydown', onDocumentKeyDown);
			window.removeEventListener('resize', position);
			window.removeEventListener('scroll', position, true);
			menu.remove();
		}
	};
}
