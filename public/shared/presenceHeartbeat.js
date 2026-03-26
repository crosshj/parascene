/**
 * Session-only presence: POST /api/presence/heartbeat on an interval while the tab is open.
 * Server treats users as “online” if meta.presence_last_seen_at is within a short window.
 */

/** Keep under the server “online” window (e.g. 3 min) so status stays fresh without spamming the API. */
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
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
