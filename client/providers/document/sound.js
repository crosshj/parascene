import { getChatAudibleNotificationsEnabled } from '../../shared/chatAudibleNotificationsPref.js';

const SOUND_HREF = '/audio/universfield-new-notification-07-210334.mp3';
const COOLDOWN_MS = 6000;

export function createUnreadSound({
	enabled = getChatAudibleNotificationsEnabled,
	AudioImpl = globalThis.Audio,
	href = SOUND_HREF,
	cooldownMs = COOLDOWN_MS,
} = {}) {
	let primed = false;
	let pending = false;
	let lastStartedAt = 0;
	let inFlight = false;
	let bound = false;

	function coolingDown() {
		return inFlight || (lastStartedAt > 0 && Date.now() - lastStartedAt < cooldownMs);
	}

	async function playClip({ muted = false } = {}) {
		const audio = new AudioImpl(href);
		audio.preload = 'auto';
		audio.muted = muted;
		if (!muted) audio.volume = 0.85;
		await audio.play();
		return audio;
	}

	async function prime() {
		if (!enabled() || primed) return;
		try {
			const audio = await playClip({ muted: true });
			try {
				audio.pause();
				audio.currentTime = 0;
				audio.muted = false;
			} catch { /* The gesture still counts as a prime. */ }
			primed = true;
		} catch { /* Try again on the next gesture. */ }
	}

	async function playNow() {
		if (coolingDown()) return false;
		lastStartedAt = Date.now();
		inFlight = true;
		try {
			await playClip();
			pending = false;
			return true;
		} catch {
			pending = true;
			return false;
		} finally {
			inFlight = false;
		}
	}

	async function onGesture() {
		if (!enabled()) {
			pending = false;
			return;
		}
		await prime();
		if (pending) await playNow();
	}

	function bind() {
		if (bound || typeof document === 'undefined') return;
		bound = true;
		const unlock = () => { void onGesture(); };
		document.addEventListener('pointerdown', unlock, { passive: true });
		document.addEventListener('keydown', unlock, { passive: true });
		document.addEventListener('touchstart', unlock, { passive: true });
	}

	return {
		coolingDown,
		bind,
		// Sound only while this tab is in the background. A blocked play stays queued for the next gesture.
		async play() {
			if (typeof document === 'undefined' || !enabled() || document.visibilityState !== 'hidden') return false;
			bind();
			return playNow();
		},
	};
}
