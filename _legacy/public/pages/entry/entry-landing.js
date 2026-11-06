/**
 * Landing page: nav only (Login / Sign up in header).
 */

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

export async function init(version) {
	const qs = getImportQuery(version);
	await Promise.all([
		import(`../../components/navigation/index.js${qs}`),
	]);
	const { waitForComponents } = await import(`../../shared/pageInit.js${qs}`);
	await waitForComponents(['app-navigation']);
}

