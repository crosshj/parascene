import { createSidebarModel } from '../../models/sidebar.js';
import { formatCredits } from '../../utils/format.js';
import { mountSidebarOverlays } from '../SidebarOverlays/SidebarOverlaysView.js';

function routePath(navigation) {
	const raw = navigation?.backgroundUrl || navigation?.url || location.pathname;
	try { return new URL(raw, location.origin).pathname; } catch { return location.pathname; }
}

export function createSidebarController({ view, services } = {}) {
	const { resources, state, session } = services;
	const { sidebarResource, creditsResource } = resources;

	function model() {
		const preference = state.selectors.sidebarPreference();
		const roster = sidebarResource?.data || { viewerId: resources.viewerId, threads: [], servers: [] };
		const next = createSidebarModel(preference, roster);
		if (creditsResource?.data) next.footer.credits = formatCredits(creditsResource.data.balance);
		return next;
	}

	function renderState(appState = state.get()) {
		view.update(model());
		view.syncRoute(routePath(appState.navigation));
		view.updateAccount(session.user);
	}

	function updateRoster(action) {
		if (action?.action === 'refresh-sidebar') {
			void sidebarResource?.refresh({ force: true }).catch(() => undefined);
			return;
		}
		if (!action?.row || !sidebarResource?.data) return;
		const data = sidebarResource.data;
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
		sidebarResource.setData(next);
	}

	const overlays = mountSidebarOverlays({
		onAction: handleAction,
		creditsResource,
		onClaimCredits: async () => {
			const result = await resources.creditsApi.claimDaily();
			creditsResource?.update((current) => ({ ...current, ...result, canClaim: false, viewerId: resources.viewerId }));
			return result;
		},
		onRefreshCredits: () => creditsResource?.refresh({ force: true }),
	});

	function handleAction(action) {
		if (action?.action === 'open-overlay') {
			if (action.overlay === 'account') {
				document.dispatchEvent(new CustomEvent('open-account-menu', { detail: { anchor: action.anchor } }));
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
	const unsubscribeRoster = sidebarResource?.subscribe((snapshot) => {
		if (snapshot.error?.status === 401) return session.redirectToLogin();
		view.setRosterStatus(snapshot);
		if (snapshot.data) renderState();
	});
	const unsubscribeCredits = creditsResource?.subscribe((snapshot) => {
		if (snapshot.error?.status === 401) return session.redirectToLogin();
		if (snapshot.data) renderState();
	});

	renderState();

	return {
		handleAction,
		destroy() {
			unsubscribeState();
			unsubscribeRoster?.();
			unsubscribeCredits?.();
			overlays.destroy();
		},
	};
}
