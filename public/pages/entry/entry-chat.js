/**
 * Standalone chat thread page: no app header, optional mobile bottom nav.
 */

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

export async function init(version) {
	const qs = getImportQuery(version);
	await import(`../../components/modals/server.js${qs}`);
	await import(`../../components/navigation/index.js${qs}`);
	await import(`../../components/navigation/mobile.js${qs}`);
	await import(`../../components/modals/profile.js${qs}`);
	await import(`../../components/modals/notifications.js${qs}`);
	await import(`../../components/modals/credits.js${qs}`);
	const { waitForComponents } = await import(`../../shared/pageInit.js${qs}`);
	const { initChatPage } = await import(`../chat.js${qs}`);
	const nsfwMod = await import(`../../shared/nsfwView.js${qs}`);
	/* Reveal shell before chat API work (global.css hides body until .loaded). */
	await waitForComponents([
		'app-navigation',
		'app-navigation-mobile',
		'app-modal-server',
		'app-modal-profile',
		'app-modal-notifications',
		'app-modal-credits'
	]);
	try {
		nsfwMod.initNsfwViewPreference();
	} catch {
		// ignore
	}
	document.addEventListener(
		'nsfw-preference-changed',
		() => {
			try {
				nsfwMod.applyNsfwPreference();
			} catch {
				// ignore
			}
		},
		false
	);
	document.addEventListener(
		'click',
		(e) => {
			if (nsfwMod.handleNsfwClick(e)) {
				e.preventDefault();
				e.stopPropagation();
			}
		},
		true
	);
	const root = document.querySelector('[data-chat-page]');
	if (root instanceof HTMLElement) {
		await initChatPage(root);
	}
}
