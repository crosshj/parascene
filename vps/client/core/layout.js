import './layout.css';
import { mountMobileNavigationView } from '../views/MobileNavigation/MobileNavigationView.js';
import { mountSidebarView } from '../views/Sidebar/SidebarView.js';

function getRegion(shell, name) {
	const region = shell.querySelector(`[data-layout-region="${name}"]`);
	if (!region) throw new Error(`Missing layout region: ${name}`);
	return region;
}

export function initializeLayout({ shell, navigationItems }) {
	if (!shell) throw new Error('Missing application shell');

	const outlet = getRegion(shell, 'page');
	const sidebar = mountSidebarView({
		outlet: getRegion(shell, 'sidebar'),
		navigationItems
	});
	const mobileNavigation = mountMobileNavigationView({
		outlet: getRegion(shell, 'mobile-navigation'),
		navigationItems
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
		destroy() {
			sidebar.destroy();
			mobileNavigation.destroy();
			document.body.classList.remove('beta-layout');
			document.body.style.removeProperty('--beta-sidebar-width');
		}
	};
}
