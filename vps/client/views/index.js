import { mobileNavigationItems } from '../config/sidebar.js';
import { renderCreationDetailView } from './CreationDetail/CreationDetailView.js';
import { renderCreationsView } from './Creations/CreationsView.js';
import { renderFileManagerView } from './FileManager/FileManagerView.js';
import { mountMobileNavigationView } from './MobileNavigation/MobileNavigationView.js';
import { mountSidebarView } from './Sidebar/SidebarView.js';
import { FeedView } from './Feed/FeedView.js';
import { ExploreView } from './Explore/ExploreView.js';
import { ChallengesView } from './Challenges/ChallengesView.js';
import { CommentsView } from './Comments/CommentsView.js';
import { ChannelView } from './Channel/ChannelView.js';
import { DirectMessageView } from './DirectMessage/DirectMessageView.js';
import { LibraryView } from './Library/LibraryView.js';
import { NotFoundView } from './NotFound/NotFoundView.js';
import { CreateView } from './Create/CreateView.js';
import { DoomScrollView } from './DoomScroll/DoomScrollView.js';

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
	Creations: {
		mount({ outlet, services, actions, setHeaderMenu }) {
			return cleanup(outlet, renderCreationsView({
				outlet,
				creationsProvider: services.providers.creations,
				creationsApi: services.providers.creations.api,
				creationsQuery: services.providers.creations.query,
    pendingCreations: services.providers.creations.pending,
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
				filesApi: services.providers.files.api,
				filesQuery: services.providers.files.query,
				onUnauthorized: services.session.redirectToLogin,
				setHeaderMenu,
			}));
		},
	},
	Feed: FeedView,
	Explore: ExploreView,
	Challenges: ChallengesView,
	Comments: CommentsView,
	Channel: ChannelView,
	DirectMessage: DirectMessageView,
	Library: LibraryView,
	Create: CreateView,
	DoomScroll: DoomScrollView,
	NotFound: NotFoundView,
	CreationDetail: {
		mount({ outlet, creationId, seed, actions, services }) {
			return renderCreationDetailView({
				outlet,
				creationId,
				initialSeed: seed,
    createProvider: services.providers.create,
				onNavigate: actions.navigate,
				onDismiss: actions.dismissOverlay,
			});
		},
	},
});
