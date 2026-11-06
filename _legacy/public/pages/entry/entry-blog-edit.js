/**
 * Blog editor: standalone shell (no app header, no mobile nav) — same idea as /chat.
 */

function getImportQuery(version) {
	return version && typeof version === "string" ? `?v=${encodeURIComponent(version)}` : "";
}

export async function init(version) {
	const qs = getImportQuery(version);
	const { waitForComponents } = await import(`../../shared/pageInit.js${qs}`);
	await waitForComponents([]);
}
