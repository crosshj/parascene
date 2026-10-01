import './styles/index.js';
import './elements/index.js';
import { connectLifecycle } from './app/lifecycle.js';
import { createAppResources } from './app/resources.js';
import { createAppRoutes } from './app/routes.js';
import { createApplicationState } from './app/state.js';
import { createLayout } from './core/layout.js';
import { createRouter } from './core/router.js';
import { createSession } from './core/session.js';
import { appViews as views } from './views/index.js';

const bootstrap = window.__PARASCENE_BOOTSTRAP__ || {};
const state = createApplicationState({ bootstrap });
const resources = createAppResources({ bootstrap });
const session = createSession({
	initialUser: bootstrap.user,
	onChange: (user) => state.actions.sessionChanged({ status: 'ready', user }),
	onLogout: () => resources.clearCaches(),
});
const services = { state, session, resources };
const routes = createAppRoutes({
	definitions: [
		{
			path: '/',
			view: views.Feed,
			title: 'Feed',
			icon: 'home',
			composer: 'none',
		},
		{
			path: '/feed',
			view: views.Feed,
			title: 'Feed',
			icon: 'home',
			composer: 'none',
		},
		{
			path: '/feed/doom/:creationId',
			view: views.DoomScroll,
			title: 'Doom Scroll',
			presentation: 'overlay',
			defaultBackground: '/feed',
			composer: 'none',
		},
		{
			path: '/explore',
			view: views.Explore,
			title: 'Explore',
			icon: 'globe',
			composer: 'message',
		},
		{
			path: '/challenges',
			view: views.Challenges,
			title: 'Challenges',
			icon: 'trophy',
			composer: 'message',
		},
		{
			path: '/challenges/organize',
			view: views.Challenges,
			title: 'Organize challenges',
			viewName: 'Challenges · Organize',
		},
		{
			path: '/challenges/details/:challengeId',
			view: views.Challenges,
			title: 'Challenge details',
			viewName: 'Challenges · Details',
		},
		{
			path: '/comments',
			view: views.Comments,
			title: 'Comments',
			icon: 'comments',
			composer: 'message',
		},
		{ path: '/ch/:slug', view: views.Channel, titleMode: 'channel' },
		{ path: '/dm/:slug', view: views.DirectMessage, titleMode: 'dm' },
		{
			path: '/notes',
			view: views.DirectMessage,
			titleMode: 'notes',
			slug: 'self',
		},
		{
			path: '/library',
			view: views.Library,
			title: 'Library',
			icon: 'book',
			composer: 'none',
		},
		{
			path: '/feedback',
			view: views.Channel,
			titleMode: 'feedback',
			title: '#feedback',
			slug: 'feedback',
		},
		{
			path: '/creations',
			view: views.Creations,
			title: 'My Creations',
			icon: 'picture',
			composer: 'message',
		},
		{
			path: '/files',
			view: views.FileManager,
			title: 'My Files',
			icon: 'files',
			composer: 'none',
		},
		{
			path: '/create',
			view: views.Create,
			presentation: 'overlay',
			defaultBackground: '/feed',
			title: 'Create',
			composer: 'none',
		},
		{
			path: '/creations/:creationId',
			view: views.CreationDetail,
			presentation: 'overlay',
			defaultBackground: '/creations',
			params: { id: 'creationId' },
		},
		{ path: '*', view: views.NotFound },
	],
});
const layout = createLayout({
	root: document.getElementById('app-shell'),
	views,
	services,
});
const router = createRouter({ routes, state, layout });
const lifecycle = connectLifecycle({ state, session, resources, router });

await lifecycle.start();
window.addEventListener('pagehide', lifecycle.destroy, { once: true });
