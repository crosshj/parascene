import { createAppState } from '../core/appState.js';

const SIDEBAR_PREFERENCE_KEY = 'prsn-vps-sidebar-mock';
const DEFAULT_SIDEBAR_PREFERENCE = {
	mode: 'full',
	directMessages: 'minimal',
	servers: 'minimal',
	channels: 'minimal',
};

function readSidebarPreference() {
	try {
		const stored = JSON.parse(localStorage.getItem(SIDEBAR_PREFERENCE_KEY) || 'null');
		return stored && ['full', 'minimal'].includes(stored.mode)
			? { ...DEFAULT_SIDEBAR_PREFERENCE, ...stored }
			: { ...DEFAULT_SIDEBAR_PREFERENCE };
	} catch {
		return { ...DEFAULT_SIDEBAR_PREFERENCE };
	}
}

export function createApplicationState({ bootstrap = {} } = {}) {
	const store = createAppState({
		navigation: null,
		session: {
			status: 'booting',
			user: bootstrap.user || null,
			userId: Number(bootstrap.user?.id) || null,
		},
		preferences: { sidebar: readSidebarPreference() },
	});

	const actions = {
		navigationResolved(navigation) {
			store.update((current) => ({ ...current, navigation }));
		},
		sessionChanged({ status = 'ready', user = null } = {}) {
			store.update((current) => ({
				...current,
				session: { status, user, userId: Number(user?.id) || null },
			}));
		},
		setSidebarPreference(patch = {}) {
			const next = { ...store.get().preferences.sidebar, ...patch };
			try { localStorage.setItem(SIDEBAR_PREFERENCE_KEY, JSON.stringify(next)); } catch { /* Keep it in memory. */ }
			store.update((current) => ({
				...current,
				preferences: { ...current.preferences, sidebar: next },
			}));
		},
	};

	return {
		get: store.get,
		subscribe: store.subscribe,
		actions,
		selectors: {
			navigation: (state = store.get()) => state.navigation,
			session: (state = store.get()) => state.session,
			sidebarPreference: (state = store.get()) => state.preferences.sidebar,
		},
	};
}
