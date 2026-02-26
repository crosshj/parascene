/**
 * Creation detail page: nav, nav-mobile, modals (profile, credits, notifications, publish, creation-details, share, tip-creator).
 */

import '../components/navigation/index.js';
import '../components/navigation/mobile.js';
import '../components/modals/profile.js';
import '../components/modals/credits.js';
import '../components/modals/notifications.js';
import '../components/modals/publish.js';
import '../components/modals/creation-details.js';
import '../components/modals/share.js';
import '../components/modals/tip-creator.js';

import { waitForComponents } from '../shared/pageInit.js';

const TAGS = [
	'app-navigation',
	'app-navigation-mobile',
	'app-modal-profile',
	'app-modal-credits',
	'app-modal-notifications',
	'app-modal-publish',
	'app-modal-creation-details',
	'app-modal-share',
	'app-modal-tip-creator',
];

export async function init() {
	await waitForComponents(TAGS);
}
