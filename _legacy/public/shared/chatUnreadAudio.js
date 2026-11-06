import { getChatAudibleNotificationsEnabled } from './chatAudibleNotificationsPref.js';

/**
 * Chat unread notification sound with autoplay-safe unlock flow.
 *
 * - Browsers usually block `HTMLAudioElement.play()` from async work (fetch /
 *   realtime) without a recent user gesture on this document.
 * - We install gesture listeners at load to **prime** media (quiet play) once,
 *   and to **flush** a pending notification after a blocked background play.
 * - **No sound while this tab is active** (`visibilityState === 'visible'`):
 *   direct `playChatUnreadPing()` returns immediately; only background attempts
 *   queue for flush (flush uses the gesture and may play once you touch the tab
 *   again — catch-up for a blocked background play).
 */

const CHAT_UNREAD_SOUND_HREF = '/audio/universfield-new-notification-07-210334.mp3';
/** Long enough for one clip + overlapping unread-summary refetches (nav + chat both refresh). */
const CHAT_UNREAD_PING_COOLDOWN_MS = 6000;

const CHAT_UNREAD_AUDIO_STATE_KEY = '__parasceneChatUnreadAudioState';

function getSharedState() {
	if (typeof window === 'undefined') {
		return {
			unlockHandlersBound: false,
			pendingPing: false,
			audioPrimed: false,
			lastPingStartedAt: 0,
			pingInFlight: false
		};
	}
	const existing = window[CHAT_UNREAD_AUDIO_STATE_KEY];
	if (existing && typeof existing === 'object') return existing;
	const created = {
		unlockHandlersBound: false,
		pendingPing: false,
		audioPrimed: false,
		lastPingStartedAt: 0,
		pingInFlight: false
	};
	window[CHAT_UNREAD_AUDIO_STATE_KEY] = created;
	return created;
}

function tabIsBackgrounded() {
	return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

async function primeAudioOnUserGesture() {
	const state = getSharedState();
	if (!getChatAudibleNotificationsEnabled()) return;
	if (state.audioPrimed) return;
	try {
		const a = new Audio(CHAT_UNREAD_SOUND_HREF);
		a.preload = 'auto';
		a.muted = true;
		await a.play();
		try {
			a.pause();
			a.currentTime = 0;
			a.muted = false;
		} catch {
			// ignore
		}
		state.audioPrimed = true;
	} catch {
		// try again on a later gesture
	}
}

async function playNotificationClip() {
	const a = new Audio(CHAT_UNREAD_SOUND_HREF);
	a.preload = 'auto';
	a.volume = 0.85;
	await a.play();
}

function isPingCoolingDown() {
	const state = getSharedState();
	const now = Date.now();
	return state.pingInFlight || (state.lastPingStartedAt > 0 && now - state.lastPingStartedAt < CHAT_UNREAD_PING_COOLDOWN_MS);
}

async function playNotificationClipDebounced() {
	const state = getSharedState();
	if (isPingCoolingDown()) return false;
	state.lastPingStartedAt = Date.now();
	state.pingInFlight = true;
	try {
		await playNotificationClip();
		return true;
	} finally {
		state.pingInFlight = false;
	}
}

async function tryFlushPendingPing() {
	const state = getSharedState();
	if (!state.pendingPing) return;
	if (!getChatAudibleNotificationsEnabled()) {
		state.pendingPing = false;
		return;
	}
	if (isPingCoolingDown()) return;
	try {
		// Gesture-driven: may run while tab is visible again; still OK — user
		// activated the document, and this is a single catch-up for a blocked
		// background notification.
		if (!(await playNotificationClipDebounced())) return;
		state.pendingPing = false;
	} catch {
		// still blocked; keep pendingPing true
	}
}

async function onUserGestureForChatAudio() {
	if (!getChatAudibleNotificationsEnabled()) return;
	await primeAudioOnUserGesture();
	await tryFlushPendingPing();
}

function bindUnlockHandlers() {
	const state = getSharedState();
	if (state.unlockHandlersBound) return;
	state.unlockHandlersBound = true;
	const onUnlock = () => {
		void onUserGestureForChatAudio();
	};
	document.addEventListener('pointerdown', onUnlock, { passive: true });
	document.addEventListener('keydown', onUnlock, { passive: true });
	document.addEventListener('touchstart', onUnlock, { passive: true });
}

/**
 * Play the unread notification clip (only attempts while tab is in the background).
 * @returns {Promise<boolean>} true when playback started, false when skipped / queued / blocked
 */
export async function playChatUnreadPing() {
	const state = getSharedState();
	if (typeof document === 'undefined' || typeof window === 'undefined') return false;
	if (!getChatAudibleNotificationsEnabled()) return false;
	if (!tabIsBackgrounded()) return false;
	bindUnlockHandlers();
	if (isPingCoolingDown()) return false;
	try {
		if (!(await playNotificationClipDebounced())) return false;
		state.pendingPing = false;
		return true;
	} catch {
		state.pendingPing = true;
		return false;
	}
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
	queueMicrotask(() => {
		bindUnlockHandlers();
	});
}
