/**
 * /challenges/organize entry (public). Prefers Rollup bundle when present;
 * otherwise loads source modules from /@src (local/dev).
 */
function assetQuery() {
	const v = document.querySelector('meta[name="asset-version"]')?.content?.trim();
	return v ? `?v=${encodeURIComponent(v)}` : '';
}

function esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function paintBootError(err) {
	const root = document.querySelector('[data-challenges-organize-root]');
	if (!(root instanceof HTMLElement)) return;
	const msg =
		err instanceof Error && err.message
			? err.message
			: 'Could not load organizer tools.';
	root.innerHTML = `<div class="challenges-organize-status user-text">
		<p class="challenge-pane-form-error" role="alert">${esc(msg)}</p>
		<p class="challenge-pane-muted">If this persists, the challenge organizer script failed to load.</p>
	</div>`;
}

async function loadOrganizeEntry() {
	const qs = assetQuery();
	const host = typeof location !== 'undefined' ? location.hostname : '';
	const preferSrc =
		host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
	if (!preferSrc) {
		try {
			await import(`/build/challenges-organize.bundle.js${qs}`);
			return;
		} catch {
			// Bundle missing — fall through to source when /@src is available.
		}
	}
	await import(`/@src/chat/challenges/organizePageMain.js${qs}`);
}

loadOrganizeEntry().catch((err) => {
	console.error('[challenges-organize]', err);
	paintBootError(err);
});
