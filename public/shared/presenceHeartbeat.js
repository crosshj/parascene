/**
 * Session-only presence: POST /api/presence/heartbeat on an interval while the tab is open.
 * Server treats users as “online” if meta.presence_last_seen_at is within a short window.
 */

/** Keep under the server “online” window (e.g. 3 min) so status stays fresh without spamming the API. */
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const HEARTBEAT_BACKOFF_MAX_MS = 5 * 60 * 1000;
const HEARTBEAT_ACTIVITY_WINDOW_MS = 2 * 60 * 1000;
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
	if (_inFlight) return false;
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
export function startPresenceHeartbeat() {
	if (_started || typeof window === 'undefined') return;
	_started = true;

	const stopSchedule = () => {
		if (_timer == null) return;
		clearTimeout(_timer);
		_timer = null;
	};

	const scheduleNext = () => {
		stopSchedule();
		if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
		const failureMultiplier = _consecutiveFailures > 0 ? 2 ** _consecutiveFailures : 1;
		const intervalMs = Math.min(HEARTBEAT_INTERVAL_MS * failureMultiplier, HEARTBEAT_BACKOFF_MAX_MS);
		_timer = setTimeout(() => {
			void sendPresenceHeartbeat().finally(scheduleNext);
		}, intervalMs);
	};

	void sendPresenceHeartbeat().finally(scheduleNext);
	setTimeout(() => {
		void sendPresenceHeartbeat().finally(scheduleNext);
	}, 4000);
	scheduleNext();

	const markMeaningfulActivity = () => {
		_lastMeaningfulActivityAt = Date.now();
	};
	markMeaningfulActivity();

	window.addEventListener('pointerdown', markMeaningfulActivity, { passive: true });
	window.addEventListener('keydown', markMeaningfulActivity, { passive: true });
	window.addEventListener('submit', markMeaningfulActivity, true);
	window.addEventListener('route-change', markMeaningfulActivity);
	window.addEventListener('tab-change', markMeaningfulActivity);

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			markMeaningfulActivity();
			void sendPresenceHeartbeat().finally(scheduleNext);
			return;
		}
		stopSchedule();
	});

	window.addEventListener('online', () => {
		void sendPresenceHeartbeat().finally(scheduleNext);
	});

	window.addEventListener('offline', () => {
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
			});
		} catch {
			// ignore
		}
	};
	window.addEventListener('pagehide', sendPresenceAway);
}
