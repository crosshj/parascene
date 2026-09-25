import './app.css';
import { createRouter } from './core/router.js';
import { createSession } from './core/session.js';
import { createFilesApi } from './api/files.js';
import { renderFileManagerView } from './views/FileManager/FileManagerView.js';
import { renderHomeView } from './views/Home/HomeView.js';
import { mountLayout } from './views/Layout/LayoutView.js';

const bootstrap = window.__PARASCENE_BOOTSTRAP__ || {};
const outlet = document.getElementById('app-outlet');
const shell = document.getElementById('app-shell');
const filesApi = createFilesApi(bootstrap.filesOrigin || '');

const menuItems = [
	{ label: 'Home', path: '/' },
	{ label: 'Files', path: '/files' }
];

const layout = mountLayout({
	shell,
	outlet,
	menuItems,
	accountElement: document.getElementById('header-account'),
	logoutButton: document.getElementById('logout')
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
	outlet,
	routes: {
		'/': () => renderHomeView({ outlet, user: session.user }),
		'/files': () => renderFileManagerView({ outlet, filesApi, onUnauthorized: session.redirectToLogin })
	}
});

await session.initialize();
router.start();
