/**
 * Entry bootstrapper: reads data-entry from body (or derives from body class),
 * dynamically imports the matching entry-*.js, runs its init(), then runs common app init.
 * Replaces the previous global.js "load everything" model so each page only loads its components.
 */

const ENTRY_FROM_BODY_CLASS = {
	'landing-page': 'landing',
	'blog-edit-page': 'blog-edit',
	'try-page': 'try',
	'share-page': 'try', // try.html has share-page too; use try entry
	'pricing-page': 'pricing',
	'integrations-page': 'integrations',
	'creation-detail-page': 'creation-detail',
	'style-detail-page': 'style-detail',
	'audio-clip-detail-page': 'audio-clip-detail',
	'welcome-page': 'welcome',
	'help-page': 'help',
	'party-page': 'party',
	'static-page': 'landing', // ToS, privacy: nav only
};

function getEntry() {
	const dataEntry = document.body?.dataset?.entry;
	if (dataEntry && typeof dataEntry === 'string') {
		return dataEntry.trim() || 'app';
	}
	const className = document.body?.className ?? '';
	for (const [cls, entry] of Object.entries(ENTRY_FROM_BODY_CLASS)) {
		if (className.includes(cls)) return entry;
	}
	return 'app';
}

function getAssetVersionParam() {
	const meta = document.querySelector('meta[name="asset-version"]');
	return meta?.getAttribute('content')?.trim() || '';
}

async function main() {
	const entry = getEntry();
	const v = getAssetVersionParam();
	const qs = v ? `?v=${encodeURIComponent(v)}` : '';
	let mod;
	try {
		mod = await import(`./pages/entry/entry-${entry}.js${qs}`);
	} catch (e) {
		const msg = String(e?.message || '');
		// Missing named exports / stale module graph — not a missing file. Falling back to
		// entry-app would skip page-specific components (e.g. app-modal-publish).
		const brokenGraph =
			e?.name === 'SyntaxError' || /does not provide an export named/i.test(msg);
		if (brokenGraph) {
			console.error(`Entry "entry-${entry}.js" failed to load.`, e);
			throw e;
		}
		console.warn(`Entry "entry-${entry}.js" not found, using entry-app.`, e);
		mod = await import(`./pages/entry/entry-app.js${qs}`);
	}
	if (mod && typeof mod.init === 'function') {
		await mod.init(v);
	}
	const { runCommonAppInit } = await import(`./shared/pageInit.js${qs}`);
	await runCommonAppInit();
}

main().catch(async (err) => {
	console.error('Entry init failed:', err);
	document.body.classList.add('loaded');
	const v = getAssetVersionParam();
	const qs = v ? `?v=${encodeURIComponent(v)}` : '';
	const { runCommonAppInit } = await import(`./shared/pageInit.js${qs}`);
	await runCommonAppInit();
});
