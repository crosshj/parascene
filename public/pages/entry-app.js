/**
 * App shell: Feed, Explore, Creations, Connect (servers).
 * Loads only nav, nav-mobile, modals (profile, credits, notifications, server), and those routes.
 */

import '../components/elements/tabs.js';
import '../components/navigation/index.js';
import '../components/navigation/mobile.js';
import '../components/modals/profile.js';
import '../components/modals/credits.js';
import '../components/modals/notifications.js';
import '../components/modals/server.js';
import '../components/routes/feed.js';
import '../components/routes/explore.js';
import '../components/routes/creations.js';
import '../components/routes/servers.js';

import { waitForComponents } from '../shared/pageInit.js';

const APP_TAGS = [
	'app-navigation',
	'app-navigation-mobile',
	'app-modal-profile',
	'app-modal-credits',
	'app-modal-notifications',
	'app-modal-server',
	'app-route-feed',
	'app-route-explore',
	'app-route-creations',
	'app-route-servers',
	'app-tabs',
];

export async function init() {
	await waitForComponents(APP_TAGS);
}
