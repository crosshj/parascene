// Ported from public/shared/presenceHeartbeat.js. Only ownership and disposal
// differ: the app provider owns this instance and its requests/listeners.
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const HEARTBEAT_BACKOFF_MAX_MS = 5 * 60 * 1000;
const HEARTBEAT_ACTIVITY_WINDOW_MS = 2 * 60 * 1000;

export function createPresenceHeartbeat({ fetchImpl = globalThis.fetch } = {}) {
	let _destroyed = false;
	let _startupTimer = null;
	const listeners = [];
	const controllers = new Set();
	function listen(target, type, listener, options) {
		target.addEventListener(type, listener, options);
		listeners.push(() => target.removeEventListener(type, listener, options));
	}
	async function fetch(url, options) {
		if (options.keepalive) return fetchImpl(url, options);
		const controller = new AbortController();
		controllers.add(controller);
		try { return await fetchImpl(url, { ...options, signal: controller.signal }); }
		finally { controllers.delete(controller); }
	}
	let _timer = null;
	let _started = false;
	let _inFlight = false;
	let _consecutiveFailures = 0;
	let _lastMeaningfulActivityAt = Date.now();

	function getClientAssetVersion() {
		try {
			const meta = document.querySelector('meta[name="asset-version"]');
			const v = meta?.getAttribute('content');
			return typeof v === 'string' ? v.trim() : '';
		} catch {
			return '';
		}
	}

	async function sendPresenceHeartbeat() {
		if (_destroyed || _inFlight) return false;
		if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
		if (Date.now() - _lastMeaningfulActivityAt > HEARTBEAT_ACTIVITY_WINDOW_MS) return false;
		_inFlight = true;
		try {
			const v = getClientAssetVersion();
			if (!v) return false;
			const r = await fetch('/api/presence/heartbeat', {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ v })
			});
			if (r.status === 401) return false;
			if (!r.ok) throw new Error(`heartbeat failed (${r.status})`);
			_consecutiveFailures = 0;
			return true;
		} catch {
			_consecutiveFailures = Math.min(_consecutiveFailures + 1, 6);
			return false;
		} finally {
			_inFlight = false;
		}
	}

	/**
	 * Call once per full page load (e.g. from pageInit). No-op if already started.
	 */
	function startPresenceHeartbeat() {
		if (_destroyed || _started || typeof window === 'undefined') return;
		_started = true;

		const stopSchedule = () => {
			if (_timer == null) return;
			clearTimeout(_timer);
			_timer = null;
		};

		const scheduleNext = () => {
			stopSchedule();
			if (_destroyed) return;
			if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
			if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
			const failureMultiplier = _consecutiveFailures > 0 ? 2 ** _consecutiveFailures : 1;
			const intervalMs = Math.min(HEARTBEAT_INTERVAL_MS * failureMultiplier, HEARTBEAT_BACKOFF_MAX_MS);
			_timer = setTimeout(() => {
				void sendPresenceHeartbeat().finally(scheduleNext);
			}, intervalMs);
		};

		void sendPresenceHeartbeat().finally(scheduleNext);
		_startupTimer = setTimeout(() => {
			void sendPresenceHeartbeat().finally(scheduleNext);
		}, 4000);
		scheduleNext();

		const markMeaningfulActivity = () => {
			_lastMeaningfulActivityAt = Date.now();
		};
		markMeaningfulActivity();

		listen(window, 'pointerdown', markMeaningfulActivity, { passive: true });
		listen(window, 'keydown', markMeaningfulActivity, { passive: true });
		listen(window, 'submit', markMeaningfulActivity, true);
		listen(window, 'route-change', markMeaningfulActivity);
		listen(window, 'tab-change', markMeaningfulActivity);

		listen(document, 'visibilitychange', () => {
			if (document.visibilityState === 'visible') {
				markMeaningfulActivity();
				void sendPresenceHeartbeat().finally(scheduleNext);
				return;
			}
			stopSchedule();
		});

		listen(window, 'online', () => {
			void sendPresenceHeartbeat().finally(scheduleNext);
		});

		listen(window, 'offline', () => {
			stopSchedule();
		});

		/** Clear server presence when the page is discarded (best-effort; not guaranteed on crash/kill). */
		const sendPresenceAway = () => {
			try {
				fetch('/api/presence/away', {
					method: 'POST',
					credentials: 'same-origin',
					keepalive: true,
					headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
					body: '{}'
				}).catch(() => {});
			} catch {
				// ignore
			}
		};
		listen(window, 'pagehide', sendPresenceAway);
	}

	return {
		start: startPresenceHeartbeat,
		// Native router state replaces WWW's route-change event at the app seam.
		markActivity() { _lastMeaningfulActivityAt = Date.now(); },
		destroy() {
			_destroyed = true;
			clearTimeout(_timer);
			clearTimeout(_startupTimer);
			for (const controller of controllers) controller.abort();
			controllers.clear();
			for (const remove of listeners.splice(0)) remove();
		},
	};
}
