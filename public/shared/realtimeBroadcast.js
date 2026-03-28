/**
 * Browser Supabase Realtime: private Broadcast subscriptions.
 * Use `subscribeBroadcast` for any topic/event; wrappers encode naming conventions (`room:`, `user:`, …).
 */

import { ensureSupabaseSessionForApp, getSupabaseBrowserClient } from "./supabaseBrowser.js";

const DEFAULT_ROOM_DEBOUNCE_MS = 220;

const RT_SUBSCRIBED = 'SUBSCRIBED';

/**
 * Subscribe to a private Broadcast channel. Callers own topic naming (`room:`, `user:`, etc.).
 * @param {object} opts
 * @param {string} opts.topic — Channel name (e.g. `room:123`, `user:45`)
 * @param {string} opts.event — Broadcast event name
 * @param {(envelope?: { payload?: unknown }) => void} opts.onBroadcast — receives the Supabase broadcast envelope (`payload` may be nested per event)
 * @param {number} [opts.debounceMs=0] — debounce rapid fires; `0` = every event
 * @param {() => void} [opts.onReconnect] — after transport/channel recovery (not initial subscribe); use for authoritative refetch
 * @returns {Promise<() => void>} teardown
 */
export async function subscribeBroadcast({ topic, event, onBroadcast, debounceMs = 0, onReconnect }) {
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
	/** @type {string | null} */
	let prevSubscribeStatus = null;
	let droppedAfterLive = false;

	const run = (envelope) => {
		try {
			onBroadcast(envelope);
		} catch {
			// ignore
		}
	};

	const runReconnect = () => {
		if (typeof onReconnect !== "function") return;
		try {
			onReconnect();
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
			if (prevSubscribeStatus === RT_SUBSCRIBED && status !== RT_SUBSCRIBED) {
				droppedAfterLive = true;
			}
			if (status === RT_SUBSCRIBED && droppedAfterLive) {
				droppedAfterLive = false;
				runReconnect();
			}
			prevSubscribeStatus = status;
			if (status !== RT_SUBSCRIBED && err) {
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
 * Optional `extra.onDeleted` listens for `deleted` (e.g. admin removed the whole thread).
 * @param {number} threadId
 * @param {() => void} onDirty
 * @param {{ onReconnect?: () => void; onDeleted?: () => void }} [extra]
 * @returns {Promise<() => void>}
 */
export async function subscribeRoomBroadcast(threadId, onDirty, extra = {}) {
	const tid = Number(threadId);
	if (!Number.isFinite(tid) || tid <= 0) {
		return () => {};
	}
	const onReconnect = typeof extra.onReconnect === "function" ? extra.onReconnect : undefined;
	const onDeleted = typeof extra.onDeleted === "function" ? extra.onDeleted : null;

	if (!onDeleted) {
		return subscribeBroadcast({
			topic: `room:${tid}`,
			event: "dirty",
			onBroadcast: () => onDirty(),
			debounceMs: DEFAULT_ROOM_DEBOUNCE_MS,
			onReconnect
		});
	}

	await ensureSupabaseSessionForApp();
	const sb = getSupabaseBrowserClient();
	if (!sb) {
		return () => {};
	}

	const channel = sb.channel(`room:${tid}`, { config: { private: true } });
	let debounceTimer = null;
	let deletedDebounceTimer = null;
	/** @type {string | null} */
	let prevSubscribeStatus = null;
	let droppedAfterLive = false;

	const runDirty = () => {
		try {
			onDirty();
		} catch {
			// ignore
		}
	};

	const runDeleted = () => {
		try {
			onDeleted();
		} catch {
			// ignore
		}
	};

	const runReconnect = () => {
		if (typeof onReconnect !== "function") return;
		try {
			onReconnect();
		} catch {
			// ignore
		}
	};

	channel
		.on("broadcast", { event: "dirty" }, () => {
			if (debounceTimer != null) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				debounceTimer = null;
				runDirty();
			}, DEFAULT_ROOM_DEBOUNCE_MS);
		})
		.on("broadcast", { event: "deleted" }, () => {
			if (deletedDebounceTimer != null) clearTimeout(deletedDebounceTimer);
			deletedDebounceTimer = setTimeout(() => {
				deletedDebounceTimer = null;
				runDeleted();
			}, 0);
		})
		.subscribe((status, err) => {
			if (prevSubscribeStatus === RT_SUBSCRIBED && status !== RT_SUBSCRIBED) {
				droppedAfterLive = true;
			}
			if (status === RT_SUBSCRIBED && droppedAfterLive) {
				droppedAfterLive = false;
				runReconnect();
			}
			prevSubscribeStatus = status;
			if (status !== RT_SUBSCRIBED && err) {
				console.warn("[realtime]", err);
			}
		});

	return () => {
		if (debounceTimer != null) clearTimeout(debounceTimer);
		if (deletedDebounceTimer != null) clearTimeout(deletedDebounceTimer);
		try {
			sb.removeChannel(channel);
		} catch {
			// ignore
		}
	};
}

const DEFAULT_USER_DEBOUNCE_MS = 280;

/**
 * `dirty` on `user:<appUserId>` — inbox / thread-list hints (debounced).
 * @param {number} userId — `prsn_users.id` / API viewer id
 * @param {() => void} onDirty
 * @returns {Promise<() => void>}
 */
export async function subscribeUserBroadcast(userId, onDirty) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) {
		return () => {};
	}
	return subscribeBroadcast({
		topic: `user:${uid}`,
		event: "dirty",
		onBroadcast: () => onDirty(),
		debounceMs: DEFAULT_USER_DEBOUNCE_MS,
		onReconnect: () => onDirty()
	});
}
