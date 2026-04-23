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

let unlockHandlersBound = false;
let pendingPing = false;
let audioPrimed = false;

function tabIsBackgrounded() {
	return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

async function primeAudioOnUserGesture() {
	if (!getChatAudibleNotificationsEnabled()) return;
	if (audioPrimed) return;
	try {
		const a = new Audio(CHAT_UNREAD_SOUND_HREF);
		a.preload = 'auto';
		a.volume = 0.001;
		await a.play();
		try {
			a.pause();
			a.currentTime = 0;
		} catch {
			// ignore
		}
		audioPrimed = true;
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

async function tryFlushPendingPing() {
	if (!pendingPing) return;
	if (!getChatAudibleNotificationsEnabled()) {
		pendingPing = false;
		return;
	}
	try {
		// Gesture-driven: may run while tab is visible again; still OK — user
		// activated the document, and this is a single catch-up for a blocked
		// background notification.
		await playNotificationClip();
		pendingPing = false;
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
	if (unlockHandlersBound) return;
	unlockHandlersBound = true;
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
	if (typeof document === 'undefined' || typeof window === 'undefined') return false;
	if (!getChatAudibleNotificationsEnabled()) return false;
	if (!tabIsBackgrounded()) return false;
	bindUnlockHandlers();
	try {
		await playNotificationClip();
		pendingPing = false;
		return true;
	} catch {
		pendingPing = true;
		return false;
	}
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
	queueMicrotask(() => {
		bindUnlockHandlers();
	});
}
