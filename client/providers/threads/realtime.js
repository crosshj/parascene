import { createClient } from '@supabase/supabase-js';
import { requestJson } from '../../core/request.js';

export function createThreadsRealtime({ viewerId, request = requestJson, makeClient = createClient } = {}) {
	let destroyed = false;
	let client = null;
	let connecting = null;
	const subscriptions = new Set();
	async function connect() {
		if (destroyed) return null;
		if (client) return client;
		if (connecting) return connecting;
		connecting = (async () => {
			const session = await request('/api/auth/supabase-session', { method: 'POST' });
			if (destroyed) return null;
			if (Number(session.viewer_id) !== Number(viewerId)) throw new Error('Realtime identity does not match the viewer');
			const candidate = makeClient(session.url, session.anonKey, { auth: { autoRefreshToken: true, persistSession: false, detectSessionInUrl: false } });
			const { error } = await candidate.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
			if (error || destroyed) {
				candidate.auth.stopAutoRefresh(); candidate.realtime.disconnect();
				if (error) throw error;
				return null;
			}
			client = candidate;
			return client;
		})();
		try { return await connecting; } finally { connecting = null; }
	}
	function subscribe(topic, onDirty, { onDeleted, debounceMs = 220 } = {}) {
		let active = true;
		let channel = null;
		let timer = null;
		let wasLive = false;
		let dropped = false;
		let binding = false;
		function dirty() {
			clearTimeout(timer);
			timer = setTimeout(() => { if (active && !destroyed) onDirty(); }, debounceMs);
		}
		async function bind() {
			if (!active || destroyed || channel || binding) return;
			binding = true;
			try {
				const sb = await connect();
				if (!sb || !active || destroyed) return;
				channel = sb.channel(topic, { config: { private: true } });
				channel.on('broadcast', { event: 'dirty' }, dirty);
				if (onDeleted) channel.on('broadcast', { event: 'deleted' }, () => { if (active && !destroyed) onDeleted(); });
				channel.subscribe((status) => {
					if (!active || destroyed) return;
					if (status === 'SUBSCRIBED') {
						// Close the fetch/subscribe gap on first connect as well as recovery.
						if (!wasLive || dropped) dirty();
						wasLive = true; dropped = false;
					} else if (wasLive) dropped = true;
				});
			} catch (error) { if (active && !destroyed) console.warn('[threads] realtime unavailable:', error.message); }
			finally { binding = false; }
		}
		function release() {
			active = false; clearTimeout(timer);
			if (channel && client) void client.removeChannel(channel).catch(() => undefined);
			channel = null; subscriptions.delete(entry);
		}
		const entry = { bind, release };
		subscriptions.add(entry);
		void bind();
		return release;
	}
	return {
		subscribe,
		retry() { for (const entry of subscriptions) void entry.bind(); },
		destroy() {
			destroyed = true;
			for (const entry of [...subscriptions]) entry.release();
			client?.auth.stopAutoRefresh(); client?.realtime.disconnect(); client = null;
		},
	};
}
