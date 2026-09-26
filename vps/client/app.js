import './app.css';
import { createAppState } from './core/appState.js';
import { initializeLayout } from './core/layout.js';
import { createRouter } from './core/router.js';
import { createSession } from './core/session.js';
import { createFilesApi } from './api/files.js';
import { renderFileManagerView } from './views/FileManager/FileManagerView.js';
import { renderHomeView } from './views/Home/HomeView.js';
import { renderMockRouteView } from './views/MockRoute/MockRouteView.js';
import { createSidebarModel, mobileNavigationItems } from './mocks/sidebar.js';
import { isSidebarRouteActive } from './utils/sidebarRoutes.js';

const bootstrap = window.__PARASCENE_BOOTSTRAP__ || {};
const shell = document.getElementById('app-shell');
const filesApi = createFilesApi(bootstrap.filesOrigin || '');

const SIDEBAR_MOCK_STORAGE_KEY = 'prsn-vps-sidebar-mock';
let sidebarMockPreference = { mode: 'full', directMessages: 'minimal', servers: 'minimal', channels: 'minimal' };
try {
	const storedPreference = JSON.parse(localStorage.getItem(SIDEBAR_MOCK_STORAGE_KEY) || 'null');
	if (storedPreference && ['full', 'minimal'].includes(storedPreference.mode)) sidebarMockPreference = { ...sidebarMockPreference, ...storedPreference };
} catch { /* Use the default full mock when storage is unavailable or invalid. */ }
const sidebarState = createAppState(createSidebarModel(sidebarMockPreference));
let layout;

function updateSidebarMock(preference) {
	sidebarMockPreference = { ...sidebarMockPreference, ...preference };
	try { localStorage.setItem(SIDEBAR_MOCK_STORAGE_KEY, JSON.stringify(sidebarMockPreference)); } catch { /* The control remains usable for this page view. */ }
	sidebarState.set(createSidebarModel(sidebarMockPreference));
}

function updateRoster(action) {
	if (!action?.row) return;
	sidebarState.update((current) => {
		const next = structuredClone(current);
		for (const key of ['directMessages', 'servers', 'channels']) {
			const index = next[key].findIndex((item) => item.id === action.row);
			if (index < 0) continue;
			if (action.action === 'hide' || action.action === 'leave') next[key].splice(index, 1);
			if (action.action === 'pin') next[key].unshift(...next[key].splice(index, 1));
			if (action.action === 'mark-read') next[key][index].unread = 0;
			break;
		}
		return next;
	});
}

layout = initializeLayout({
	shell,
	sidebarModel: sidebarState.get(),
	mobileNavigationItems,
	onSidebarAction: updateRoster
});
const unsubscribeSidebar = sidebarState.subscribe(layout.updateSidebar);
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
		'/': () => renderHomeView({ outlet: layout.outlet, user: session.user, sidebarMock: sidebarMockPreference, onSidebarMockChange: updateSidebarMock }),
		'/files': () => renderFileManagerView({ outlet: layout.outlet, filesApi, onUnauthorized: session.redirectToLogin, setHeaderMenu: layout.setHeaderMenu }),
		'*': ({ path }) => {
			const item = [...sidebarState.get().navigation, ...sidebarState.get().directMessages, ...sidebarState.get().servers, ...sidebarState.get().channels].find((entry) => isSidebarRouteActive(entry, path));
			return renderMockRouteView({ outlet: layout.outlet, title: item?.label?.replace(/^[@#]/, '') || 'Coming soon' });
		}
	},
	onRouteChange: ({ path }) => {
		layout.syncRoute(path);
		const item = [...sidebarState.get().navigation, ...sidebarState.get().directMessages, ...sidebarState.get().servers, ...sidebarState.get().channels].find((entry) => isSidebarRouteActive(entry, path));
		layout.setPage({
			key: path,
			title: path === '/' ? 'Feed' : item?.label?.replace(/^[@#]/, '') || 'Coming soon',
			icon: item?.icon || (item?.route?.kind === 'dm' ? 'user' : item?.route?.kind === 'channel' ? 'comments' : 'home'),
			showComposer: path !== '/files'
		});
	}
});

await session.initialize();
router.start();

window.addEventListener('pagehide', unsubscribeSidebar, { once: true });
