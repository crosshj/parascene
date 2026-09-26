import './app.css';
import { createAppState } from './core/appState.js';
import { initializeLayout } from './core/layout.js';
import { createRouter } from './core/router.js';
import { createSession } from './core/session.js';
import { createFilesApi } from './api/files.js';
import { createSidebarApi } from './api/sidebar.js';
import { createCreditsApi } from './api/credits.js';
import { createResource } from './core/resource.js';
import { createResourceRegistry } from './core/resourceRegistry.js';
import { createStorageCache } from './core/storageCache.js';
import { renderFileManagerView } from './views/FileManager/FileManagerView.js';
import { renderHomeView } from './views/Home/HomeView.js';
import { renderMockRouteView } from './views/MockRoute/MockRouteView.js';
import { createSidebarModel } from './models/sidebar.js';
import { mobileNavigationItems } from './config/sidebar.js';
import { isSidebarRouteActive, parseSidebarPath } from './utils/sidebarRoutes.js';

const bootstrap = window.__PARASCENE_BOOTSTRAP__ || {};
const shell = document.getElementById('app-shell');
const filesApi = createFilesApi(bootstrap.filesOrigin || '');
const sidebarApi = createSidebarApi();
const creditsApi = createCreditsApi();
const viewerId = Number(bootstrap.user?.id) || null;
const appResources = createResourceRegistry();

const SIDEBAR_MOCK_STORAGE_KEY = 'prsn-vps-sidebar-mock';
let sidebarMockPreference = { mode: 'full', directMessages: 'minimal', servers: 'minimal', channels: 'minimal' };
try {
	const storedPreference = JSON.parse(localStorage.getItem(SIDEBAR_MOCK_STORAGE_KEY) || 'null');
	if (storedPreference && ['full', 'minimal'].includes(storedPreference.mode)) sidebarMockPreference = { ...sidebarMockPreference, ...storedPreference };
} catch { /* Use the default full mock when storage is unavailable or invalid. */ }
let layout;

const sidebarCache = viewerId ? createStorageCache(`prsn-vps-sidebar-roster-v1:${viewerId}`, {
	validate: (data) => Number(data?.viewerId) === viewerId && Array.isArray(data.threads) && Array.isArray(data.servers)
}) : null;
const sidebarLease = viewerId ? appResources.acquire(['sidebar-roster', viewerId], () => createResource({
	key: ['sidebar-roster', viewerId], cache: sidebarCache, maxAge: 45_000,
	load: ({ signal, current }) => sidebarApi.load({ signal, current })
})) : null;
const sidebarResource = sidebarLease?.resource || null;
const creditsCache = viewerId ? createStorageCache(`prsn-vps-credits-v1:${viewerId}`, {
	validate: (data) => Number(data?.viewerId) === viewerId && Number.isFinite(Number(data.balance))
}) : null;
const creditsLease = viewerId ? appResources.acquire(['credits', viewerId], () => createResource({
	key: ['credits', viewerId], cache: creditsCache, maxAge: 60_000,
	load: async ({ signal }) => ({ ...(await creditsApi.get({ signal })), viewerId })
})) : null;
const creditsResource = creditsLease?.resource || null;

const sidebarState = createAppState(createSidebarModel(sidebarMockPreference, sidebarResource?.data || { viewerId, threads: [], servers: [] }));

function currentSidebarModel() {
	const model = createSidebarModel(sidebarMockPreference, sidebarResource?.data || { viewerId, threads: [], servers: [] });
	model.footer.credits = creditsResource?.data?.balance ?? '';
	return model;
}

if (sidebarResource?.data) sidebarState.set(currentSidebarModel());

function updateSidebarMock(preference) {
	sidebarMockPreference = { ...sidebarMockPreference, ...preference };
	try { localStorage.setItem(SIDEBAR_MOCK_STORAGE_KEY, JSON.stringify(sidebarMockPreference)); } catch { /* The control remains usable for this page view. */ }
	sidebarState.set(currentSidebarModel());
}

function syncPageChrome(path = location.pathname) {
	const item = [...sidebarState.get().navigation, ...sidebarState.get().directMessages, ...sidebarState.get().servers, ...sidebarState.get().channels].find((entry) => isSidebarRouteActive(entry, path));
	const parsed = parseSidebarPath(path);
	const fallbackTitle = path === '/' ? 'Feed'
		: parsed.kind === 'dm' ? (parsed.userName || 'Direct message')
			: parsed.kind === 'channel' ? (parsed.slug || 'Channel')
				: 'Coming soon';
	layout.setPage({
		key: path,
		title: path === '/' ? 'Feed' : item?.label?.replace(/^[@#]/, '') || fallbackTitle,
		icon: item?.icon || (item?.route?.kind === 'dm' ? 'user' : item?.route?.kind === 'channel' ? 'comments' : 'home'),
		showComposer: path !== '/files'
	});
}

function updateRoster(action) {
	if (action?.action === 'refresh-sidebar') {
		void sidebarResource?.refresh({ force: true }).catch(() => undefined);
		return;
	}
	if (!action?.row) return;
	if (!sidebarResource?.data) return;
	const data = sidebarResource.data;
	const next = { ...data, threads: data.threads.map((row) => ({ ...row })), servers: data.servers.map((row) => ({ ...row })), pinnedIds: [...(data.pinnedIds || [])], hiddenIds: [...(data.hiddenIds || [])], readMarkers: { ...(data.readMarkers || {}) } };
	const itemId = String(action.row);
	if (action.action === 'hide' || action.action === 'leave') next.hiddenIds = [...new Set([...next.hiddenIds, itemId])];
	if (action.action === 'pin') next.pinnedIds = next.pinnedIds.includes(itemId) ? next.pinnedIds.filter((id) => id !== itemId) : [...next.pinnedIds, itemId];
	if (action.action === 'mark-read') {
		const sidebarItem = [...sidebarState.get().directMessages, ...sidebarState.get().servers, ...sidebarState.get().channels].find((item) => item.id === itemId);
		const threadId = Number(sidebarItem?.route?.threadId || itemId.replace(/^(dm|channel|server)-/, ''));
		const thread = next.threads.find((row) => Number(row.id) === threadId);
		const marker = Number(thread?.last_message?.id) || Number(thread?.last_read_message_id) || 0;
		next.readMarkers[String(threadId)] = marker;
		next.threads = next.threads.map((row) => Number(row.id) === threadId ? { ...row, unread_count: 0, last_read_message_id: marker || row.last_read_message_id } : row);
	}
	sidebarResource.setData(next);
}

layout = initializeLayout({
	shell,
	sidebarModel: currentSidebarModel(),
	mobileNavigationItems,
	onSidebarAction: updateRoster,
	creditsResource,
	onClaimCredits: async () => {
		try {
			const result = await creditsApi.claimDaily();
			creditsResource?.update((current) => ({ ...current, ...result, canClaim: false, viewerId }));
			return result;
		} catch (error) {
			try { await creditsResource?.refresh({ force: true }); } catch { /* retain known-good balance */ }
			throw error;
		}
	}
});
const unsubscribeSidebar = sidebarState.subscribe(layout.updateSidebar);
let session;
const unsubscribeRoster = sidebarResource?.subscribe((snapshot) => {
	if (snapshot.error?.status === 401) {
		sidebarCache?.clear(); creditsCache?.clear(); filesCache?.clear();
		session?.redirectToLogin();
		return;
	}
	layout.setSidebarStatus(snapshot);
	if (snapshot.data && Number(snapshot.data.viewerId) === viewerId) {
		sidebarState.set(currentSidebarModel());
		syncPageChrome();
	}
});
const unsubscribeCredits = creditsResource?.subscribe((snapshot) => {
	if (snapshot.error?.status === 401) {
		sidebarCache?.clear(); creditsCache?.clear(); filesCache?.clear();
		session?.redirectToLogin();
		return;
	}
	if (snapshot.data) layout.updateCredits(snapshot.data.balance);
});
if (sidebarResource) void sidebarResource.refresh().catch(() => undefined);
if (creditsResource) void creditsResource.refresh().catch(() => undefined);
const filesCache = viewerId ? createStorageCache(`prsn-vps-files-v1:${viewerId}`, {
	validate: (data) => Array.isArray(data?.files) && data.files.every((file) => file && typeof file.id === 'string')
}) : null;
const filesLease = viewerId ? appResources.acquire(['files', viewerId], () => createResource({
	key: ['files', viewerId], cache: filesCache, maxAge: 5 * 60_000,
	load: ({ signal }) => filesApi.list({ signal })
})) : null;
const filesResource = filesLease?.resource || null;

function syncExternalCache(event) {
	const targets = [
		[sidebarCache, sidebarResource, `prsn-vps-sidebar-roster-v1:${viewerId}`],
		[creditsCache, creditsResource, `prsn-vps-credits-v1:${viewerId}`],
		[filesCache, filesResource, `prsn-vps-files-v1:${viewerId}`]
	];
	for (const [cache, resource, key] of targets) {
		if (!resource || event.key !== key) continue;
		const entry = cache?.read?.();
		if (entry) resource.setData(entry.data, { persist: false, updated: entry.updatedAt });
		else void resource.refresh({ force: true }).catch(() => undefined);
	}
}
let lastAppRefreshAt = 0;
function refreshSharedResources() {
	if (document.visibilityState === 'hidden' || Date.now() - lastAppRefreshAt < 5_000) return;
	lastAppRefreshAt = Date.now();
	if (sidebarResource) void sidebarResource.refresh({ force: true }).catch(() => undefined);
	if (creditsResource) void creditsResource.refresh({ force: true }).catch(() => undefined);
}
function onVisibilityChange() { if (document.visibilityState === 'visible') refreshSharedResources(); }
window.addEventListener('storage', syncExternalCache);
window.addEventListener('focus', refreshSharedResources);
document.addEventListener('visibilitychange', onVisibilityChange);
const sharedRefreshInterval = window.setInterval(refreshSharedResources, 45_000);
session = createSession({
	initialUser: bootstrap.user,
	accountElement: layout.accountElement,
	avatarElement: layout.avatarElement,
	avatarInitial: layout.avatarInitial,
	avatarImage: layout.avatarImage,
	logoutButton: layout.logoutButton,
	onLogout() {
		sidebarCache?.clear();
		creditsCache?.clear();
		filesCache?.clear();
		appResources.clear();
	}
});

const router = createRouter({
	outlet: layout.outlet,
	routes: {
		'/': () => renderHomeView({ outlet: layout.outlet, user: session.user, sidebarMock: sidebarMockPreference, onSidebarMockChange: updateSidebarMock }),
		'/files': () => renderFileManagerView({ outlet: layout.outlet, filesApi, filesResource, onUnauthorized: session.redirectToLogin, setHeaderMenu: layout.setHeaderMenu }),
		'*': ({ path }) => {
			const item = [...sidebarState.get().navigation, ...sidebarState.get().directMessages, ...sidebarState.get().servers, ...sidebarState.get().channels].find((entry) => isSidebarRouteActive(entry, path));
			return renderMockRouteView({ outlet: layout.outlet, title: item?.label?.replace(/^[@#]/, '') || 'Coming soon' });
		}
	},
	onRouteChange: ({ path }) => {
		layout.syncRoute(path);
		syncPageChrome(path);
	}
});

await session.initialize();
router.start();

window.addEventListener('pagehide', () => {
	unsubscribeSidebar();
	unsubscribeRoster?.();
	unsubscribeCredits?.();
	window.removeEventListener('storage', syncExternalCache);
	window.removeEventListener('focus', refreshSharedResources);
	document.removeEventListener('visibilitychange', onVisibilityChange);
	window.clearInterval(sharedRefreshInterval);
	sidebarLease?.release();
	creditsLease?.release();
	filesLease?.release();
	appResources.clear();
}, { once: true });
