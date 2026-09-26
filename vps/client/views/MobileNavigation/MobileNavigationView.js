import { escapeHtml, htmlFragment, mountTemplate } from '../../utils/dom.js';
import template from './MobileNavigationView.html';
import './MobileNavigationView.css';

function navigationMarkup(items) {
	return items.map(({ label, path }) => `<a class="mobile-navigation-view__item" href="${escapeHtml(path)}" data-spa-link>${escapeHtml(label)}</a>`).join('');
}

export function mountMobileNavigationView({ outlet, navigationItems }) {
	const root = mountTemplate(outlet, template);
	root.style.setProperty('--mobile-navigation-count', Math.max(1, navigationItems.length));
	root.append(htmlFragment(navigationMarkup(navigationItems)));

	return {
		root,
		destroy() {
			root.remove();
		}
	};
}
