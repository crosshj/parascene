/**
 * Party Mode: standalone shell (no app header, no mobile nav, no feed/explore routes).
 */

const TAGS = [
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
		import(`../../components/modals/profile.js${qs}`),
		import(`../../components/modals/about.js`),
		import(`../../components/modals/credits.js${qs}`),
		import(`../../components/modals/notifications.js${qs}`),
	]);
	const { waitForComponents } = await import(`../../shared/pageInit.js${qs}`);
	await waitForComponents(TAGS);
}
