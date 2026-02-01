// Global components that all pages will use
import './components/navigation/index.js';
import './components/navigation/mobile.js';
import './components/elements/tabs.js';
import './components/modals/profile.js';
import './components/modals/credits.js';
import './components/modals/notifications.js';
import './components/modals/server.js';
import './components/modals/user.js';
import './components/modals/todo.js';
import './components/modals/creation-details.js';
import './components/routes/feed.js';
import './components/routes/explore.js';
import './components/routes/servers.js';
import './components/routes/creations.js';
import './components/routes/create.js';
import './components/routes/templates.js';
import './components/routes/users.js';
import './components/routes/todo.js';
import { refreshAutoGrowTextareas } from './shared/autogrow.js';

// Wait for DOM and custom elements to be ready before showing content
async function initPage() {
	// Wait for DOM to be ready
	if (document.readyState === 'loading') {
		await new Promise(resolve => {
			document.addEventListener('DOMContentLoaded', resolve);
		});
	}

	// Wait for all custom elements to be defined
	const customElementTags = [
		'app-navigation',
		'app-navigation-mobile',
		'app-tabs',
		'app-modal-profile',
		'app-modal-credits',
		'app-modal-notifications',
		'app-modal-server',
		'app-modal-user',
		'app-modal-todo',
		'app-modal-creation-details',
		'app-route-feed',
		'app-route-explore',
		'app-route-creations',
		'app-route-servers',
		'app-route-create',
		'app-route-templates',
		'app-route-users',
		'app-route-todo',
		'app-route-servers'
	];
	await Promise.all(
		customElementTags.map(tag => customElements.whenDefined(tag))
	);

	// Small delay to ensure components are fully initialized and rendered
	await new Promise(resolve => {
		requestAnimationFrame(() => {
			requestAnimationFrame(resolve);
		});
	});

	// Show the page
	document.body.classList.add('loaded');

	// Auto-grow textareas (run after components + layout settle)
	try {
		refreshAutoGrowTextareas(document);
	} catch {
		// ignore
	}
	try {
		const fonts = document.fonts;
		if (fonts?.ready && typeof fonts.ready.then === 'function') {
			fonts.ready.then(() => refreshAutoGrowTextareas(document)).catch(() => {});
		}
	} catch {
		// ignore
	}
}

initPage();

// Keep autogrow heights correct when UI changes visibility/layout.
document.addEventListener('tab-change', () => {
	try { refreshAutoGrowTextareas(document); } catch { /* ignore */ }
});
document.addEventListener('route-change', () => {
	try { refreshAutoGrowTextareas(document); } catch { /* ignore */ }
});
window.addEventListener('resize', () => {
	try { refreshAutoGrowTextareas(document); } catch { /* ignore */ }
});
window.addEventListener('orientationchange', () => {
	try { refreshAutoGrowTextareas(document); } catch { /* ignore */ }
});

document.addEventListener('modal-opened', () => {
	setTimeout(() => {
		try { refreshAutoGrowTextareas(document); } catch { /* ignore */ }
	}, 0);
});


function registerServiceWorker() {
	if (!("serviceWorker" in navigator)) {
		return;
	}

	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch(error => {
			// console.warn("Service worker registration failed:", error);
		});
	});
}

registerServiceWorker();

// Prevent body scrolling when shadow DOM modals are open
// Regular DOM modals are handled by CSS :has() selector
// Shadow DOM modals dispatch events to toggle body class
let shadowModalCount = 0;

function updateBodyClass() {
	if (shadowModalCount > 0) {
		document.body.classList.add('modal-open');
	} else {
		document.body.classList.remove('modal-open');
	}
}

document.addEventListener('modal-opened', () => {
	shadowModalCount++;
	updateBodyClass();
});

document.addEventListener('modal-closed', () => {
	shadowModalCount = Math.max(0, shadowModalCount - 1);
	updateBodyClass();
});