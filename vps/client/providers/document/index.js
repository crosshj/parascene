import { getChatAudibleNotificationsEnabled } from '../../shared/chatAudibleNotificationsPref.js';
import { dailyClaimAvailable } from '../credits/dailyClaim.js';
import { composeAttention, composeDocumentTitle, DOCUMENT_TITLE_PREFIX, explainTitleCount, faviconHref, messageUnread, shouldPing } from './chrome.js';
import { createUnreadSound } from './sound.js';

const POLL_MS = 45_000;

export function createDocumentProvider({
	threads,
	notifications,
	credits,
	audible = getChatAudibleNotificationsEnabled,
	sound = createUnreadSound({ enabled: audible }),
	pollMs = POLL_MS,
	target = typeof document === 'undefined' ? null : document,
} = {}) {
	let baseTitle = 'parascene';
	let baseline = null;
	let seenThreads = !threads?.query;
	let seenNotifications = !notifications?.query;
	let seenCredits = !credits?.query;
	let defaultIcon = '/favicon.svg';
	let timer = 0;
	let started = false;
	let snapshot = composeAttention();
	const listeners = new Set();
	const stops = [];

	function challengeVotes() {
		const votes = Number(threads?.challengeAttention);
		return Number.isFinite(votes) ? votes : null;
	}

	function currentAttention() {
		const notes = notifications?.query?.data;
		const creditsData = credits?.query?.data;
		return composeAttention({
			messages: messageUnread(threads?.query?.data, challengeVotes()),
			notifications: notes,
			dailyClaim: dailyClaimAvailable(creditsData) ? 1 : 0,
			notificationsKnown: Boolean(notes),
			claimKnown: Boolean(creditsData),
		});
	}

	function publish() {
		snapshot = currentAttention();
		for (const listener of listeners) listener(snapshot);
		return snapshot;
	}

	function applyIcon(total) {
		const link = target?.querySelector?.('link[rel="icon"][type="image/svg+xml"]');
		if (!link) return;
		const current = (link.getAttribute('href') || '').trim().split('?')[0];
		if (!current.includes('favicon-unread')) defaultIcon = current || defaultIcon;
		const next = faviconHref(total, defaultIcon);
		if (current !== next) link.setAttribute('href', next);
	}

	function apply() {
		const total = publish().total;
		if (target) target.title = composeDocumentTitle(baseTitle, total);
		applyIcon(total);
		return total;
	}

	function observe() {
		const ready = seenThreads && seenNotifications && seenCredits;
		const next = apply();
		if (!ready) return;
		if (baseline === null) {
			baseline = next;
			return;
		}
		if (shouldPing({
			initialized: true,
			previous: baseline,
			next,
			hidden: target?.visibilityState === 'hidden',
			audible: audible() === true,
		})) void sound.play();
		baseline = next;
	}

	function refresh() {
		void threads?.query?.refresh({ force: true }).catch(() => undefined);
		void notifications?.query?.refresh({ force: true }).catch(() => undefined);
		void notifications?.listQuery?.refresh({ force: true }).catch(() => undefined);
		void credits?.query?.refresh({ force: true }).catch(() => undefined);
	}

	function start() {
		if (started) return;
		started = true;
		sound.bind?.();
		if (threads?.query) {
			stops.push(threads.query.subscribe((snapshot) => {
				if (snapshot?.data || snapshot?.error) seenThreads = true;
				observe();
			}));
		}
		if (typeof threads?.subscribeChallengeAttention === 'function') {
			stops.push(threads.subscribeChallengeAttention(() => observe()));
		}
		if (notifications?.query) {
			stops.push(notifications.query.subscribe((snapshot) => {
				if (snapshot?.data || snapshot?.error) seenNotifications = true;
				observe();
			}));
			void notifications.query.loadIfNeeded?.().catch(() => undefined);
			void notifications.listQuery?.loadIfNeeded?.().catch(() => undefined);
		}
		if (credits?.query) {
			stops.push(credits.query.subscribe((snapshot) => {
				if (snapshot?.data || snapshot?.error) seenCredits = true;
				observe();
			}));
			void credits.query.loadIfNeeded?.().catch(() => undefined);
		}
		if (target?.addEventListener) {
			const onAcknowledged = () => { void notifications?.query?.refresh({ force: true }).catch(() => undefined); };
			target.addEventListener('notifications-acknowledged', onAcknowledged);
			stops.push(() => target.removeEventListener('notifications-acknowledged', onAcknowledged));
		}
		if (pollMs > 0) timer = setInterval(refresh, pollMs);
		observe();
	}

	return {
		get baseTitle() { return baseTitle; },
		attention() { return snapshot; },
		subscribe(listener) {
			listeners.add(listener);
			listener(snapshot);
			return () => listeners.delete(listener);
		},
		explain() {
			return explainTitleCount({
				inbox: threads?.query?.data,
				notifications: notifications?.query?.data,
				challengeAttention: challengeVotes(),
				dailyClaim: currentAttention().dailyClaim,
			});
		},
		setTitle(title) {
			baseTitle = String(title || '').replace(DOCUMENT_TITLE_PREFIX, '').trim() || 'parascene';
			apply();
		},
		start,
		refresh,
		preload() {},
		syncExternalCache() {},
		clearCache() {},
		destroy() {
			clearInterval(timer);
			timer = 0;
			while (stops.length) stops.pop()();
			started = false;
		},
	};
}
