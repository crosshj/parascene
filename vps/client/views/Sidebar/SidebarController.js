import { createSidebarModel } from './SidebarModel.js';
import { formatCredits } from '../../utils/format.js';
import { pinDmKey, unpinDmKey } from '../../shared/chatDmPins.js';
import { isSidebarRouteActive } from '../../utils/sidebarRoutes.js';
import { mountSidebarOverlays } from '../SidebarOverlays/SidebarOverlaysView.js';
import { mountSidebarSectionModals } from './SidebarSectionModals.js';

function routePath(navigation) {
	const raw = navigation?.backgroundUrl || navigation?.url || location.pathname;
	try { return new URL(raw, location.origin).pathname; } catch { return location.pathname; }
}

export function createSidebarController({ view, services, actions } = {}) {
	const { providers, state, session } = services;
const settings=document.createElement('app-modal-profile'),about=document.createElement('app-modal-about'),serverModal=document.createElement('app-modal-server');document.body.append(settings,about,serverModal);const accountMenu=document.createElement('app-account-menu');accountMenu.onSettings=()=>settings.open();accountMenu.onAbout=()=>about.open();accountMenu.onNavigate=actions?.navigate;accountMenu.onLogout=session.logout;document.body.appendChild(accountMenu);function refreshServers(){void threadsQuery?.refresh({force:true});}document.addEventListener('servers-updated',refreshServers);document.addEventListener('server-updated',refreshServers);
	const threadsQuery = providers.threads.query;
	const creditsQuery = providers.credits.query;

	function model() {
		const preference = state.selectors.sidebarPreference();
		const roster = threadsQuery?.data || { viewerId: providers.viewerId, threads: [], servers: [] };
		const next = createSidebarModel(preference, roster, providers.presence);
		if (creditsQuery?.data) next.footer.credits = formatCredits(creditsQuery.data.balance);
		return next;
	}

	function renderState(appState = state.get()) {
		view.update(model());
		view.syncRoute(routePath(appState.navigation));
		view.updateAccount(session.user);
	}

	function findItem(id) {
		const current = model();
		return [...current.directMessages, ...current.servers, ...current.channels].find((entry) => entry.id === id) || null;
	}

	const sectionModals = mountSidebarSectionModals({
		api: providers.threads.api,
		getThreads: () => threadsQuery?.data?.threads || [],
		getViewerId: () => providers.viewerId,
		navigate: (href) => actions?.navigate(href),
		refresh: () => threadsQuery?.refresh({ force: true }),
	});

	async function handleRosterAction(action) {
		const item = findItem(action?.row);
		if (!item) return;
		const threadId = Number(item.route?.threadId);
		if (action.action === 'profile' && item.profilePath) {
			void actions?.navigate(item.profilePath);
			return;
		}
		if (action.action === 'server-details' && item.server?.id) {
			void serverModal.open({ mode: item.server.canManage ? 'edit' : 'view', serverId: item.server.id });
			return;
		}
		if ((action.action === 'pin' || action.action === 'unpin') && item.pinKey) {
			if (action.action === 'pin') pinDmKey(item.pinKey);
			else unpinDmKey(item.pinKey);
			renderState();
			return;
		}
		if (action.action === 'mark-read') {
			if (!(threadId > 0)) return;
			if (!(item.lastMessageId > 0)) {
				threadsQuery?.update((current) => current ? {
					...current,
					threads: current.threads.map((row) => Number(row.id) === threadId ? { ...row, unread_count: 0 } : row),
				} : current);
				return;
			}
			await providers.threads.markRead(threadId, item.lastMessageId);
			return;
		}
		if (action.action === 'hide' || action.action === 'leave') {
			if (!(threadId > 0)) return;
			const closing = action.action === 'hide';
			const confirmed = await sectionModals.confirm({
				title: closing ? 'Close DM' : 'Leave channel',
				message: closing
					? `Close your DM with ${item.label}? It will reappear in your sidebar if they message you again.`
					: `Leave ${item.label}?`,
				confirmLabel: closing ? 'Close DM' : 'Leave channel',
				run: async () => {
					if (closing) {
						await providers.threads.api.markThreadHidden(threadId);
						if (item.pinKey) unpinDmKey(item.pinKey);
					} else await providers.threads.api.leaveThread(threadId);
					await threadsQuery?.refresh({ force: true });
				},
			});
			if (confirmed && isSidebarRouteActive(item, routePath(state.get().navigation))) void actions?.navigate('/feed');
		}
	}

	const overlays = mountSidebarOverlays({
		onAction: handleAction,
		creditsQuery,
		onClaimCredits: async () => {
			const result = await providers.credits.api.claimDaily();
			creditsQuery?.update((current) => ({ ...current, ...result, canClaim: false, viewerId: providers.viewerId }));
			return result;
		},
		onRefreshCredits: () => creditsQuery?.refresh({ force: true }),
	});

	function handleAction(action) {
		if (action?.action === 'open-overlay') {
			if (action.overlay === 'account') {
				void accountMenu.open(action.anchor);
				return;
			}
			overlays.open(action.overlay, action.anchor);
			return;
		}
		if (action?.action === 'logout') {
			void session.logout();
			return;
		}
		if (action?.action === 'refresh-sidebar') {
			void providers.presence?.refresh();
			void threadsQuery?.refresh({ force: true }).catch(() => undefined);
			return;
		}
		if (action?.action === 'open-section') {
			sectionModals.open(action.section);
			return;
		}
		void handleRosterAction(action).catch(() => undefined);
	}

	const unsubscribeState = state.subscribe(renderState);
	const unsubscribePresence = providers.presence?.query.subscribe((snapshot) => {
		// WWW paints its cached snapshot before fetching, then paints the result.
		// Both renders participate in the offline-grace calculation.
		if (snapshot.data) view.update(model());
	});
	const unsubscribeRoster = threadsQuery?.subscribe((snapshot) => {
		if (snapshot.error?.status === 401) return session.redirectToLogin();
		view.setRosterStatus(snapshot);
		if (snapshot.data) {
			providers.presence?.setThreads(snapshot.data.threads);
			renderState();
		}
	});
	const unsubscribeCredits = creditsQuery?.subscribe((snapshot) => {
		if (snapshot.error?.status === 401) return session.redirectToLogin();
		if (snapshot.data) renderState();
	});

	renderState();
	if (threadsQuery) void threadsQuery.loadIfNeeded().catch(() => undefined);

	return {
		handleAction,
		destroy() {
			unsubscribeState();
			unsubscribePresence?.();
			unsubscribeRoster?.();
			unsubscribeCredits?.();
			document.removeEventListener('servers-updated', refreshServers);
			document.removeEventListener('server-updated', refreshServers);
			overlays.destroy();sectionModals.destroy();accountMenu.remove();settings.close();settings.remove();about.close();about.remove();serverModal.close();serverModal.remove();
		},
	};
}
