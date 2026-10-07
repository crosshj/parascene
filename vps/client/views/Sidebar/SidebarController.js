import { createSidebarModel } from './SidebarModel.js';
import { formatCredits } from '../../utils/format.js';
import { mountSidebarOverlays } from '../SidebarOverlays/SidebarOverlaysView.js';

function routePath(navigation) {
	const raw = navigation?.backgroundUrl || navigation?.url || location.pathname;
	try { return new URL(raw, location.origin).pathname; } catch { return location.pathname; }
}

export function createSidebarController({ view, services, actions } = {}) {
	const { providers, state, session } = services;
const settings=document.createElement('app-modal-profile'),about=document.createElement('app-modal-about');document.body.append(settings,about);const accountMenu=document.createElement('app-account-menu');accountMenu.onSettings=()=>settings.open();accountMenu.onAbout=()=>about.open();accountMenu.onNavigate=actions?.navigate;accountMenu.onLogout=session.logout;document.body.appendChild(accountMenu);
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

	function updateRoster(action) {
		if (action?.action === 'refresh-sidebar') {
			void providers.presence?.refresh();
			void threadsQuery?.refresh({ force: true }).catch(() => undefined);
			return;
		}
		if (!action?.row || !threadsQuery?.data) return;
		const data = threadsQuery.data;
		const next = {
			...data,
			threads: data.threads.map((row) => ({ ...row })),
			servers: data.servers.map((row) => ({ ...row })),
			pinnedIds: [...(data.pinnedIds || [])],
			hiddenIds: [...(data.hiddenIds || [])],
			readMarkers: { ...(data.readMarkers || {}) },
		};
		const itemId = String(action.row);
		if (action.action === 'hide' || action.action === 'leave') next.hiddenIds = [...new Set([...next.hiddenIds, itemId])];
		if (action.action === 'pin') next.pinnedIds = next.pinnedIds.includes(itemId)
			? next.pinnedIds.filter((id) => id !== itemId)
			: [...next.pinnedIds, itemId];
		if (action.action === 'mark-read') {
			const item = [...model().directMessages, ...model().servers, ...model().channels].find((entry) => entry.id === itemId);
			const threadId = Number(item?.route?.threadId || itemId.replace(/^(dm|channel|server)-/, ''));
			const thread = next.threads.find((row) => Number(row.id) === threadId);
			next.readMarkers[String(threadId)] = Number(thread?.last_message?.id) || Number(thread?.last_read_message_id) || 0;
			next.threads = next.threads.map((row) => Number(row.id) === threadId
				? { ...row, unread_count: 0, last_read_message_id: next.readMarkers[String(threadId)] || row.last_read_message_id }
				: row);
		}
		threadsQuery.setData(next);
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
		updateRoster(action);
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
			overlays.destroy();accountMenu.remove();settings.close();settings.remove();about.close();about.remove();
		},
	};
}
