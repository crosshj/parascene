import './layout.css';
import { mountMobileNavigationView } from '../views/MobileNavigation/MobileNavigationView.js';
import { mountSidebarView } from '../views/Sidebar/SidebarView.js';
import { mountSidebarOverlays } from '../views/SidebarOverlays/SidebarOverlaysView.js';

function getRegion(shell, name) {
	const region = shell.querySelector(`[data-layout-region="${name}"]`);
	if (!region) throw new Error(`Missing layout region: ${name}`);
	return region;
}

export function initializeLayout({ shell, sidebarModel, mobileNavigationItems, onSidebarAction }) {
	if (!shell) throw new Error('Missing application shell');

	const outlet = getRegion(shell, 'page');
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
		accountElement: sidebar.accountElement,
		avatarElement: sidebar.avatarElement,
		avatarInitial: sidebar.avatarInitial,
		avatarImage: sidebar.avatarImage,
		logoutButton: sidebar.logoutButton,
		syncRoute: sidebar.syncRoute,
		updateSidebar: sidebar.update,
		destroy() {
			overlays.destroy();
			sidebar.destroy();
			mobileNavigation.destroy();
			document.body.classList.remove('beta-layout');
			document.body.style.removeProperty('--beta-sidebar-width');
		}
	};
}
