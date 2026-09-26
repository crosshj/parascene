import './app.css';
import { initializeLayout } from './core/layout.js';
import { createRouter } from './core/router.js';
import { createSession } from './core/session.js';
import { createFilesApi } from './api/files.js';
import { renderFileManagerView } from './views/FileManager/FileManagerView.js';
import { renderHomeView } from './views/Home/HomeView.js';

const bootstrap = window.__PARASCENE_BOOTSTRAP__ || {};
const shell = document.getElementById('app-shell');
const filesApi = createFilesApi(bootstrap.filesOrigin || '');

const navigationItems = [
	{ label: 'Home', path: '/' },
	{ label: 'Files', path: '/files' }
];

const layout = initializeLayout({
	shell,
	navigationItems
});
const session = createSession({
	initialUser: bootstrap.user,
	accountElement: layout.accountElement,
	avatarElement: layout.avatarElement,
	avatarInitial: layout.avatarInitial,
	avatarImage: layout.avatarImage,
	logoutButton: layout.logoutButton
});

const router = createRouter({
	outlet: layout.outlet,
	routes: {
		'/': () => renderHomeView({ outlet: layout.outlet, user: session.user }),
		'/files': () => renderFileManagerView({ outlet: layout.outlet, filesApi, onUnauthorized: session.redirectToLogin })
	}
});

await session.initialize();
router.start();
