/**
 * Entry bootstrapper: reads data-entry from body (or derives from body class),
 * dynamically imports the matching entry-*.js, runs its init(), then runs common app init.
 * Replaces the previous global.js "load everything" model so each page only loads its components.
 */

const ENTRY_FROM_BODY_CLASS = {
	'landing-page': 'landing',
	'blog-edit-page': 'blog-edit',
	'create-page': 'create',
	'try-page': 'try',
	'share-page': 'try', // try.html has share-page too; use try entry
	'pricing-page': 'pricing',
	'creation-detail-page': 'creation-detail',
	'creation-edit-page': 'creation-edit',
	'welcome-page': 'welcome',
	'help-page': 'help',
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
