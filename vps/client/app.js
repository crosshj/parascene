import './styles/index.js';
import './elements/index.js';
import { connectLifecycle } from './app/lifecycle.js';
import { createAppProviders } from './providers/index.js';
import { createAppRoutes } from './app/routes.js';
import { createApplicationState } from './app/state.js';
import { createLayout } from './core/layout.js';
import { createRouter } from './core/router.js';
import { createSession } from './core/session.js';
import { appViews as views } from './views/index.js';

const legacyThreadRoutes = [
	// TODO: Deprecate these legacy thread URLs in favor of the /ch/ channel route pattern;
	// migrate private-channel URL generation when replacing these routes.
	{
		path: '/chat/t/:threadId/:threadName',
		view: views.Channel,
		titleMode: 'thread',
		icon: 'comments',
		composer: 'message',
	},
	{
		path: '/chat/t/:threadId',
		view: views.Channel,
		titleMode: 'thread',
		icon: 'comments',
		composer: 'message',
	},
];

const routeDefinitions = [
	{
		path: '/',
		view: views.Feed,
		title: 'Feed',
		icon: 'home',
		composer: 'creation',
	},
	{
		path: '/feed',
		view: views.Feed,
		title: 'Feed',
		icon: 'home',
		composer: 'creation',
	},
	{
		path: '/feed/doom/:creationId',
		view: views.DoomScroll,
		title: 'Doom Scroll',
		icon: 'chart',
		presentation: 'overlay',
		defaultBackground: '/feed',
		composer: 'none',
	},
	{
		path: '/explore',
		view: views.Explore,
		title: 'Explore',
		icon: 'globe',
		composer: 'search',
	},
	{
		path: '/challenges',
		view: views.Challenges,
		title: 'Challenges',
		icon: 'trophy',
		composer: 'creation',
	},
	{
		path: '/challenges/organize',
		view: views.Challenges,
		title: 'Organize challenges',
		viewName: 'Challenges · Organize',
		icon: 'trophy',
		composer: 'none',
	},
	{
		path: '/challenges/details/:challengeId',
		view: views.Challenges,
		title: 'Challenge details',
		viewName: 'Challenges · Details',
		icon: 'trophy',
		composer: 'none',
	},
	{
		path: '/comments',
		view: views.Comments,
		title: 'Comments',
		icon: 'comments',
		composer: 'none',
	},
	{
		path: '/ch/:slug',
		view: views.Channel,
		titleMode: 'channel',
		icon: 'comments',
		composer: 'message',
	},
	{
		path: '/dm/:slug',
		view: views.DirectMessage,
		titleMode: 'dm',
		icon: 'user',
		composer: 'message',
	},
	{
		path: '/notes',
		view: views.DirectMessage,
		titleMode: 'notes',
		slug: 'self',
		icon: 'notes',
		composer: 'message',
	},
	{
		path: '/library',
		view: views.Library,
		title: 'Library',
		icon: 'book',
		composer: 'none',
	},
{path:'/user',view:views.UserProfile,presentation:'overlay',defaultBackground:'/creations',title:'My profile',composer:'none'},
{path:'/user/:userId',view:views.UserProfile,presentation:'overlay',defaultBackground:'/explore',title:'Profile',composer:'none'},
{path:'/p/:username',view:views.UserProfile,presentation:'overlay',defaultBackground:'/explore',title:'Profile',composer:'none'},
{path:'/t/:tag',view:views.UserProfile,presentation:'overlay',defaultBackground:'/explore',title:'Tag',composer:'none'},
{path:'/integrations',view:views.Connections,presentation:'overlay',defaultBackground:'/creations',title:'Connections',composer:'none'},
{ path: '/prompt-library', view: views.Library, title: 'Prompt Library', icon: 'book', composer: 'none' },
	{ path: '/styles/new', view: views.Library, title: 'Library', icon: 'book', composer: 'none' },
	{ path: '/styles/:slug', view: views.Library, title: 'Library', icon: 'book', composer: 'none' },
	{ path: '/audio-clips/:clipId', view: views.Library, presentation: 'page', title: 'Library', composer: 'none' },
	{
		path: '/feedback',
		view: views.Channel,
		title: 'Feedback',
		slug: 'feedback',
		icon: 'megaphone',
		composer: 'message',
	},
	{
		path: '/creations',
		view: views.Creations,
		title: 'My Creations',
		icon: 'picture',
		composer: 'creation',
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
		defaultBackground: '/creations',
		restoreBackgroundOnLoad: false,
		title: 'Create',
		icon: 'plus',
		composer: 'none',
	},
	{
		path: '/creations/:creationId',
		view: views.CreationDetail,
		icon: 'picture',
		presentation: 'overlay',
		defaultBackground: '/creations',
	},
	{
		path: '/creations/:creationId/edit',
		dismissToPreviousOverlay: true,
		view: views.Create,
		presentation: 'overlay',
		defaultBackground: '/creations',
		restoreBackgroundOnLoad: false,
		title: 'Mutate',
		icon: 'plus',
		composer: 'none',
	},
	{
		path: '/creations/:creationId/mutate',
		dismissToPreviousOverlay: true,
		view: views.Create,
		presentation: 'overlay',
		defaultBackground: '/creations',
		restoreBackgroundOnLoad: false,
		title: 'Mutate',
		icon: 'plus',
		composer: 'none',
	},
	...legacyThreadRoutes,
	{
		path: '*',
		view: views.NotFound,
		title: 'Not Found',
		icon: 'info',
		composer: 'none',
	},
];

const bootstrap = window.__PARASCENE_BOOTSTRAP__ || {};
const state = createApplicationState({ bootstrap });
const providers = createAppProviders({ bootstrap });
// Avatar-bearing dialogs and overlays can be mounted beside the app shell.
providers.avatars.start(document.documentElement);
const session = createSession({
	initialUser: bootstrap.user,
	onChange: (user) => state.actions.sessionChanged({ status: 'ready', user }),
	onLogout: () => providers.clearCaches(),
});
const services = { state, session, providers };
const routes = createAppRoutes({ definitions: routeDefinitions });
const layout = createLayout({
	root: document.getElementById('app-shell'),
	views,
	services,
});
const router = createRouter({ routes, state, layout });
const lifecycle = connectLifecycle({ state, session, providers, router });

await lifecycle.start();
window.addEventListener('pagehide', lifecycle.destroy, { once: true });
