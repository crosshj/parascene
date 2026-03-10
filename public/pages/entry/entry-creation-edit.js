/**
 * Creation edit page: nav, nav-mobile, modals (profile, credits, notifications).
 */

const TAGS = [
	'app-navigation',
	'app-navigation-mobile',
	'app-modal-profile',
	'app-modal-credits',
	'app-modal-notifications',
];

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

export async function init(version) {
	const qs = getImportQuery(version);
	await Promise.all([
		import(`../../components/navigation/index.js${qs}`),
		import(`../../components/navigation/mobile.js${qs}`),
		import(`../../components/modals/profile.js${qs}`),
		import(`../../components/modals/credits.js${qs}`),
		import(`../../components/modals/notifications.js${qs}`),
	]);
	const { waitForComponents } = await import(`../../shared/pageInit.js${qs}`);
	await waitForComponents(TAGS);
}

