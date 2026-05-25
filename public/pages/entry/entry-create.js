/**
 * Create page: nav, nav-mobile, modals; basic create mounts createComposer; advanced mounts app-route-create.
 */

const TAGS_BASIC = ['app-navigation', 'app-navigation-mobile'];
const TAGS_ADVANCED = [...TAGS_BASIC, 'app-tabs', 'app-route-create'];

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

export async function init(version) {
	const qs = getImportQuery(version);
	const isAdvanced = document.body.classList.contains('create-page-advanced');
	await Promise.all([
		import(`../../components/navigation/index.js${qs}`),
		import(`../../components/navigation/mobile.js${qs}`),
		import(`../../components/modals/profile.js${qs}`),
		import(`../../components/modals/credits.js${qs}`),
		import(`../../components/modals/notifications.js${qs}`),
		import(`../../components/modals/server.js${qs}`),
		...(isAdvanced
			? [
					import(`../../components/elements/tabs.js${qs}`),
					import(`../../components/routes/create.js${qs}`),
				]
			: []),
	]);
	const { waitForComponents } = await import(`../../shared/pageInit.js${qs}`);
	const { refreshAutoGrowTextareas } = await import(`../../shared/autogrow.js${qs}`);
	await waitForComponents(isAdvanced ? TAGS_ADVANCED : TAGS_BASIC);
	runCreatePageInit(refreshAutoGrowTextareas);
}

function runCreatePageInit(refreshAutoGrowTextareas) {
	if (document.body.classList.contains('create-page-advanced')) return;
	if (!document.body.classList.contains('create-page')) return;

	const host = document.querySelector('[data-create-composer-host]');
	if (!(host instanceof HTMLElement)) return;

	const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
	const qs = v ? `?v=${encodeURIComponent(v)}` : '';

	import(`../../shared/createComposer.js${qs}`).then(({ mountCreateComposer }) => {
		mountCreateComposer(host, {
			refreshAutoGrowTextareas,
			navigate: 'full',
		});
	});
}
