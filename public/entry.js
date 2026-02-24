/**
 * Entry bootstrapper: reads data-entry from body (or derives from body class),
 * dynamically imports the matching entry-*.js, runs its init(), then runs common app init.
 * Replaces the previous global.js "load everything" model so each page only loads its components.
 */

import { runCommonAppInit } from './shared/pageInit.js';

const ENTRY_FROM_BODY_CLASS = {
	'landing-page': 'landing',
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

async function main() {
	const entry = getEntry();
	let mod;
	try {
		mod = await import(`./pages/entry-${entry}.js`);
	} catch (e) {
		console.warn(`Entry "entry-${entry}.js" not found, using entry-app.`, e);
		mod = await import('./pages/entry-app.js');
	}
	if (mod && typeof mod.init === 'function') {
		await mod.init();
	}
	runCommonAppInit();
}

main().catch((err) => {
	console.error('Entry init failed:', err);
	document.body.classList.add('loaded');
	runCommonAppInit();
});
