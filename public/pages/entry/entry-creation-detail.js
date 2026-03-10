/**
 * Creation detail page: nav, nav-mobile, modals (profile, credits, notifications, publish, creation-details, share, tip-creator).
 * Imports are dynamic with cache-busting (version) so components are not served from cache.
 */

const TAGS = [
	'app-navigation',
	'app-navigation-mobile',
	'app-modal-profile',
	'app-modal-credits',
	'app-modal-notifications',
	'app-modal-publish',
	'app-modal-creation-details',
	'app-modal-share',
	'app-modal-tip-creator',
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
		import(`../../components/modals/publish.js${qs}`),
		import(`../../components/modals/creation-details.js${qs}`),
		import(`../../components/modals/share.js${qs}`),
		import(`../../components/modals/tip-creator.js${qs}`),
	]);
	const { waitForComponents } = await import(`../../shared/pageInit.js${qs}`);
	await waitForComponents(TAGS);
}

