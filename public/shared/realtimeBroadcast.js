/**
 * Browser Supabase Realtime: private Broadcast subscriptions.
 * Use `subscribeBroadcast` for any topic/event; wrappers encode naming conventions (`room:`, `user:`, …).
 */

import { ensureSupabaseSessionForApp, getSupabaseBrowserClient } from "./supabaseBrowser.js";

const DEFAULT_ROOM_DEBOUNCE_MS = 220;

/**
 * Subscribe to a private Broadcast channel. Callers own topic naming (`room:`, `user:`, etc.).
 * @param {object} opts
 * @param {string} opts.topic — Channel name (e.g. `room:123`, `user:45`)
 * @param {string} opts.event — Broadcast event name
 * @param {(envelope?: { payload?: unknown }) => void} opts.onBroadcast — receives the Supabase broadcast envelope (`payload` may be nested per event)
 * @param {number} [opts.debounceMs=0] — debounce rapid fires; `0` = every event
 * @returns {Promise<() => void>} teardown
 */
export async function subscribeBroadcast({ topic, event, onBroadcast, debounceMs = 0 }) {
	if (typeof topic !== "string" || !topic.trim()) {
		return () => {};
	}
	if (typeof event !== "string" || !event.trim()) {
		return () => {};
	}
	if (typeof onBroadcast !== "function") {
		return () => {};
	}

	await ensureSupabaseSessionForApp();
	const sb = getSupabaseBrowserClient();
	if (!sb) {
		return () => {};
	}

	const channel = sb.channel(topic.trim(), { config: { private: true } });
	let debounceTimer = null;
	const ms = Number(debounceMs);
	const useDebounce = Number.isFinite(ms) && ms > 0;

	const run = (envelope) => {
		try {
			onBroadcast(envelope);
		} catch {
			// ignore
		}
	};

	channel
		.on("broadcast", { event: event.trim() }, (envelope) => {
			if (useDebounce) {
				if (debounceTimer != null) clearTimeout(debounceTimer);
				debounceTimer = setTimeout(() => {
					debounceTimer = null;
					run(envelope);
				}, ms);
			} else {
				run(envelope);
			}
		})
		.subscribe((status, err) => {
			if (status !== "SUBSCRIBED" && err) {
				console.warn("[realtime]", err);
			}
		});

	return () => {
		if (debounceTimer != null) clearTimeout(debounceTimer);
		try {
			sb.removeChannel(channel);
		} catch {
			// ignore
		}
	};
}

/**
 * Subscribe to `dirty` on `room:<threadId>` with debounced invalidation callback (chat thread stream).
 * @param {number} threadId
 * @param {() => void} onDirty
 * @returns {Promise<() => void>}
 */
export async function subscribeRoomBroadcast(threadId, onDirty) {
	const tid = Number(threadId);
	if (!Number.isFinite(tid) || tid <= 0) {
		return () => {};
	}
	return subscribeBroadcast({
		topic: `room:${tid}`,
		event: "dirty",
		onBroadcast: () => onDirty(),
		debounceMs: DEFAULT_ROOM_DEBOUNCE_MS
	});
}
