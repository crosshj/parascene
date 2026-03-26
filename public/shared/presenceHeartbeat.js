/**
 * Session-only presence: POST /api/presence/heartbeat on an interval while the tab is open.
 * Server treats users as “online” if meta.presence_last_seen_at is within a short window.
 */

const HEARTBEAT_INTERVAL_MS = 90 * 1000;
let _timer = null;
let _started = false;

async function sendPresenceHeartbeat() {
	try {
		const r = await fetch('/api/presence/heartbeat', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { Accept: 'application/json' }
		});
		if (r.status === 401) return;
	} catch {
		// ignore
	}
}

/**
 * Call once per full page load (e.g. from pageInit). No-op if already started.
 */
export function startPresenceHeartbeat() {
	if (_started || typeof window === 'undefined') return;
	_started = true;

	const schedule = () => {
		if (_timer != null) clearInterval(_timer);
		_timer = setInterval(sendPresenceHeartbeat, HEARTBEAT_INTERVAL_MS);
	};

	void sendPresenceHeartbeat();
	setTimeout(sendPresenceHeartbeat, 4000);
	schedule();

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			void sendPresenceHeartbeat();
		}
	});
}
