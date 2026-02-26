/**
 * Not found page: nav, nav-mobile, modals (profile, credits, notifications).
 */

import '../components/navigation/index.js';
import '../components/navigation/mobile.js';
import '../components/modals/profile.js';
import '../components/modals/credits.js';
import '../components/modals/notifications.js';

import { waitForComponents } from '../shared/pageInit.js';

const TAGS = [
	'app-navigation',
	'app-navigation-mobile',
	'app-modal-profile',
	'app-modal-credits',
	'app-modal-notifications',
];

export async function init() {
	await waitForComponents(TAGS);
}
