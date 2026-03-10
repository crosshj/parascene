/**
 * Admin app shell: Todo, Users, Connect; modals (profile, credits, notifications, server, user, todo); tabs.
 */

const TAGS = [
	'app-navigation',
	'app-modal-profile',
	'app-modal-credits',
	'app-modal-notifications',
	'app-modal-server',
	'app-modal-user',
	'app-modal-todo',
	'app-route-todo',
	'app-route-users',
	'app-route-servers',
	'app-tabs',
];

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

export async function init(version) {
	const qs = getImportQuery(version);
	await Promise.all([
		import(`../../components/navigation/index.js${qs}`),
		import(`../../components/modals/profile.js${qs}`),
		import(`../../components/modals/credits.js${qs}`),
		import(`../../components/modals/notifications.js${qs}`),
		import(`../../components/modals/server.js${qs}`),
		import(`../../components/modals/user.js${qs}`),
		import(`../../components/modals/todo.js${qs}`),
		import(`../../components/routes/todo.js${qs}`),
		import(`../../components/routes/users.js${qs}`),
		import(`../../components/routes/servers.js${qs}`),
		import(`../../components/elements/tabs.js${qs}`),
	]);
	const { waitForComponents } = await import(`../../shared/pageInit.js${qs}`);
	await waitForComponents(TAGS);
}

