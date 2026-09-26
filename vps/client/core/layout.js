import './layout.css';
import { mountMobileNavigationView } from '../views/MobileNavigation/MobileNavigationView.js';
import { mountSidebarView } from '../views/Sidebar/SidebarView.js';
import { mountSidebarOverlays } from '../views/SidebarOverlays/SidebarOverlaysView.js';
import { createPopupMenu } from '../components/PopupMenu/PopupMenu.js';
import { iconMarkup } from '../components/Icon/Icon.js';

function getRegion(shell, name) {
	const region = shell.querySelector(`[data-layout-region="${name}"]`);
	if (!region) throw new Error(`Missing layout region: ${name}`);
	return region;
}

export function initializeLayout({ shell, sidebarModel, mobileNavigationItems, onSidebarAction }) {
	if (!shell) throw new Error('Missing application shell');

	const page = getRegion(shell, 'page');
	page.classList.add('beta-outlet');
	page.innerHTML = `
		<div class="beta-outlet__frame">
			<header class="beta-outlet__header">
				<div class="beta-outlet__identity"><span class="beta-outlet__icon"></span><h1 class="beta-outlet__title"></h1></div>
				<div class="beta-outlet__actions">
					<button class="beta-outlet__action beta-outlet__more" type="button" aria-label="More options" aria-haspopup="menu" aria-expanded="false">${iconMarkup('more')}</button>
				</div>
			</header>
			<div class="beta-outlet__scroll"><div class="beta-outlet__content"></div></div>
			<form class="beta-outlet__composer" aria-label="Message composer">
				<textarea rows="1" aria-label="Write a message" placeholder="Write a message…"></textarea>
				<button type="button" aria-label="Add attachment">${iconMarkup('plus')}</button>
				<button type="submit" aria-label="Send message" disabled>${iconMarkup('send')}</button>
			</form>
		</div>`;
	const outlet = page.querySelector('.beta-outlet__content');
	const scrollRegion = page.querySelector('.beta-outlet__scroll');
	const pageTitle = page.querySelector('.beta-outlet__title');
	const pageIcon = page.querySelector('.beta-outlet__icon');
	const composer = page.querySelector('.beta-outlet__composer');
	let menu = null;
	const menuButton = page.querySelector('.beta-outlet__more');
	menuButton.hidden = true;
	menuButton.addEventListener('click', (event) => menu?.toggle(event.currentTarget));
	composer.addEventListener('submit', (event) => event.preventDefault());
	let pageKey = '';
	let sidebar;
	const handleSidebarAction = (action) => {
		if (action?.action === 'logout') {
			sidebar?.logoutButton?.click();
			return;
		}
		onSidebarAction?.(action);
	};
	const overlays = mountSidebarOverlays({ onAction: handleSidebarAction });
	const sidebarAction = (action) => {
		if (action?.action === 'open-overlay') {
			overlays.open(action.overlay, action.anchor);
			return;
		}
		handleSidebarAction(action);
	};
	sidebar = mountSidebarView({
		outlet: getRegion(shell, 'sidebar'),
		model: sidebarModel,
		onAction: sidebarAction
	});
	const mobileNavigation = mountMobileNavigationView({
		outlet: getRegion(shell, 'mobile-navigation'),
		navigationItems: mobileNavigationItems
	});

	document.body.classList.add('beta-layout');

	return {
		shell,
		outlet,
		setPage({ key = '', title, icon = 'home', showComposer = true } = {}) {
			if (key !== pageKey) {
				pageKey = key;
				menu?.destroy();
				menu = null;
				menuButton.hidden = true;
			}
			pageTitle.textContent = title || 'Feed';
			pageIcon.innerHTML = iconMarkup(icon);
			composer.hidden = !showComposer;
		},
		setHeaderMenu({ label = 'Page actions', items = [], onSelect } = {}) {
			menu?.destroy();
			menu = items.length ? createPopupMenu({ label, items, onSelect }) : null;
			menuButton.hidden = !menu;
		},
		accountElement: sidebar.accountElement,
		avatarElement: sidebar.avatarElement,
		avatarInitial: sidebar.avatarInitial,
		avatarImage: sidebar.avatarImage,
		logoutButton: sidebar.logoutButton,
		syncRoute: sidebar.syncRoute,
		updateSidebar: sidebar.update,
		destroy() {
			menu?.destroy();
			overlays.destroy();
			sidebar.destroy();
			mobileNavigation.destroy();
			document.body.classList.remove('beta-layout');
			document.body.style.removeProperty('--beta-sidebar-width');
		}
	};
}
