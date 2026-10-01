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
		{ name: 'home', path: '/', view: views.Home },
		{ name: 'creations', path: '/creations', view: views.Creations },
		{ name: 'files', path: '/files', view: views.FileManager },
		{
			name: 'creation-detail',
			path: '/creations/:creationId',
			view: views.CreationDetail,
			presentation: 'overlay',
			defaultBackground: '/creations',
		},
		{ name: 'fallback', path: '*', view: views.MockRoute },
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
