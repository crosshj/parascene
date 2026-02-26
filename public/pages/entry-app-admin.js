/**
 * Admin app shell: Todo, Users, Connect; modals (profile, credits, notifications, server, user, todo); tabs.
 */

import '../components/navigation/index.js';
import '../components/modals/profile.js';
import '../components/modals/credits.js';
import '../components/modals/notifications.js';
import '../components/modals/server.js';
import '../components/modals/user.js';
import '../components/modals/todo.js';
import '../components/routes/todo.js';
import '../components/routes/users.js';
import '../components/routes/servers.js';
import '../components/elements/tabs.js';

import { waitForComponents } from '../shared/pageInit.js';

const TAGS = [
	'app-navigation',
	'app-modal-profile',
	'app-modal-credits',
	'app-modal-notifications',
	'app-modal-server',
	'app-modal-user',
	'app-modal-todo',
	'app-route-todo',
	'app-route-users',
	'app-route-servers',
	'app-tabs',
];

export async function init() {
	await waitForComponents(TAGS);
}
