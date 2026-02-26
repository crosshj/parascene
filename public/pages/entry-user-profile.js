/**
 * User profile page: nav, nav-mobile, tabs, modals (profile, credits, notifications).
 * Page script (user-profile.js) is loaded separately in the HTML.
 */

import '../components/navigation/index.js';
import '../components/navigation/mobile.js';
import '../components/elements/tabs.js';
import '../components/modals/profile.js';
import '../components/modals/credits.js';
import '../components/modals/notifications.js';

import { waitForComponents } from '../shared/pageInit.js';

const TAGS = [
	'app-navigation',
	'app-navigation-mobile',
	'app-tabs',
	'app-modal-profile',
	'app-modal-credits',
	'app-modal-notifications',
];

export async function init() {
	await waitForComponents(TAGS);
}
