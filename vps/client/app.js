import { createFilesApi } from './api/files.js';
import { createRouter } from './core/router.js';
import { createSession } from './core/session.js';
import { renderFilesPage } from './pages/files.js';
import { renderHomePage } from './pages/home.js';

const bootstrap = window.__PARASCENE_BOOTSTRAP__ || {};
const outlet = document.getElementById('app-outlet');
const filesApi = createFilesApi(bootstrap.filesOrigin || '');
const session = createSession({
	initialUser: bootstrap.user,
	accountElement: document.getElementById('header-account'),
	logoutButton: document.getElementById('logout')
});

const router = createRouter({
	outlet,
	routes: {
		'/': () => renderHomePage({ outlet, user: session.user }),
		'/files': () => renderFilesPage({ outlet, filesApi, onUnauthorized: session.redirectToLogin })
	}
});

await session.initialize();
router.start();
