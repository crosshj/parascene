/**
 * App shell: Feed, Explore, Creations, Connect (servers).
 * Loads only nav, nav-mobile, modals (profile, credits, notifications, server), and those routes.
 */

const APP_TAGS = [
	'app-navigation',
	'app-navigation-mobile',
	'app-modal-profile',
	'app-modal-credits',
	'app-modal-notifications',
	'app-modal-server',
	'app-route-feed',
	'app-route-explore',
	'app-route-creations',
	'app-route-servers',
	'app-tabs',
];

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

export async function init(version) {
	const qs = getImportQuery(version);
	await Promise.all([
		import(`../../components/elements/tabs.js${qs}`),
		import(`../../components/navigation/index.js${qs}`),
		import(`../../components/navigation/mobile.js${qs}`),
		import(`../../components/modals/profile.js${qs}`),
		import(`../../components/modals/credits.js${qs}`),
		import(`../../components/modals/notifications.js${qs}`),
		import(`../../components/modals/server.js${qs}`),
		import(`../../components/routes/feed.js${qs}`),
		import(`../../components/routes/explore.js${qs}`),
		import(`../../components/routes/creations.js${qs}`),
		import(`../../components/routes/servers.js${qs}`),
	]);
	const { waitForComponents } = await import(`../../shared/pageInit.js${qs}`);
	await waitForComponents(APP_TAGS);
}

