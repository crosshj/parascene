/**
 * Welcome (onboarding) page: no web components in body; just show page.
 */

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

export async function init(version) {
	const qs = getImportQuery(version);
	const { waitForComponents } = await import(`../../shared/pageInit.js${qs}`);
	await waitForComponents([]);
}

