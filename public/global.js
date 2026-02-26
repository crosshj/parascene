/**
 * Legacy entry: loads the app shell (same as entry-app.js).
 * The app now uses entry.js + per-page entry-*.js so each page only loads its components.
 * If this script is loaded directly (e.g. old bookmark), we default to app and run the entry bootstrapper.
 */

if (document.body && !document.body.dataset.entry) {
	document.body.dataset.entry = 'app';
}

import('./entry.js').catch((err) => {
	console.error('global.js fallback failed:', err);
	document.body.classList.add('loaded');
});
