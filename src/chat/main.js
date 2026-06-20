/**
 * Rollup entry for the chat route bundle → `public/build/chat.bundle.js` (see `src/rollup.config.mjs`).
 *
 * Flow: register shell web components → mount chat UI → bundled common init (static imports, `src/shared/runBundledCommonInit.js`).
 */

import '../shared/components/modals/server.js';
import '../shared/components/navigation/index.js';
import '../shared/components/navigation/mobile.js';
import '../shared/components/modals/profile.js';
import '../shared/components/modals/notifications.js';
import '../shared/components/modals/credits.js';
import '../shared/components/modals/about.js';
import { initChatViewportShellSync } from './chatViewportShellSync.js';
import { waitForComponents } from '../shared/waitForComponents.js';
import { applyNsfwPreference } from '../shared/nsfwView.js';
import { initChatPage } from './chatPage.js';
import { runBundledCommonAppInit } from '../shared/runBundledCommonInit.js';

async function mountChatUi() {
	await waitForComponents([
		'app-navigation',
		'app-navigation-mobile',
		'app-modal-server',
		'app-modal-profile',
		'app-modal-notifications',
		'app-modal-credits'
	]);
	/** Chat toggles NSFW from settings UI; re-apply when storage/event fires (not in pageInit). */
	document.addEventListener(
		'nsfw-preference-changed',
		() => {
			try {
				applyNsfwPreference();
			} catch {
				// ignore
			}
		},
		false
	);
	const root = document.querySelector('[data-chat-page]');
	if (root instanceof HTMLElement) {
		await initChatPage(root);
	}
}

async function main() {
	initChatViewportShellSync();
	await mountChatUi();
	await runBundledCommonAppInit();
}

main().catch(async (err) => {
	console.error('Chat bundle init failed:', err);
	document.body.classList.add('loaded');
	await runBundledCommonAppInit();
});
