import { mobileNavigationItems } from '../config/sidebar.js';
import { renderCreationDetailView } from './CreationDetail/CreationDetailView.js';
import { renderCreationsView } from './Creations/CreationsView.js';
import { renderFileManagerView } from './FileManager/FileManagerView.js';
import { renderHomeView } from './Home/HomeView.js';
import { mountMobileNavigationView } from './MobileNavigation/MobileNavigationView.js';
import { renderMockRouteView } from './MockRoute/MockRouteView.js';
import { mountSidebarView } from './Sidebar/SidebarView.js';

function cleanup(outlet, dispose) {
	return {
		destroy() {
			dispose?.();
			outlet.replaceChildren();
		},
	};
}

export const appViews = Object.freeze({
	Sidebar: { mount: mountSidebarView },
	MobileNavigation: {
		mount({ outlet }) {
			return mountMobileNavigationView({ outlet, navigationItems: mobileNavigationItems });
		},
	},
	Home: {
		mount({ outlet, services }) {
			renderHomeView({
				outlet,
				user: services.session.user,
				sidebarMock: services.state.selectors.sidebarPreference(),
				onSidebarMockChange: services.state.actions.setSidebarPreference,
			});
			return cleanup(outlet);
		},
	},
	Creations: {
		mount({ outlet, services, actions, setHeaderMenu }) {
			return cleanup(outlet, renderCreationsView({
				outlet,
				creationsApi: services.resources.creationsApi,
				creationsResource: services.resources.creationsResource,
				onUnauthorized: services.session.redirectToLogin,
				setHeaderMenu,
				onOpenCreation: (id, seed) => actions.navigate(`/creations/${id}`, { seed }),
			}));
		},
	},
	FileManager: {
		mount({ outlet, services, setHeaderMenu }) {
			return cleanup(outlet, renderFileManagerView({
				outlet,
				filesApi: services.resources.filesApi,
				filesResource: services.resources.filesResource,
				onUnauthorized: services.session.redirectToLogin,
				setHeaderMenu,
			}));
		},
	},
	MockRoute: {
		mount({ outlet, title }) {
			renderMockRouteView({ outlet, title });
			return cleanup(outlet);
		},
	},
	CreationDetail: {
		mount({ outlet, creationId, seed, actions }) {
			return renderCreationDetailView({
				outlet,
				creationId,
				initialSeed: seed,
				onNavigate: actions.navigate,
				onDismiss: actions.dismissOverlay,
			});
		},
	},
});
