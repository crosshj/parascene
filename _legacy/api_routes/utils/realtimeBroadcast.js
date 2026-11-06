import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "./supabaseService.js";

/**
 * One-shot Broadcast send on a private channel (service client). Does not throw; logs warnings.
 * @param {object} opts
 * @param {string} opts.topic — e.g. `room:123`, `user:45`
 * @param {string} opts.event
 * @param {Record<string, unknown>} [opts.payload]
 */
export async function broadcastToChannel({ topic, event, payload }) {
	const sb = getSupabaseServiceClient();
	if (!sb) return;
	if (typeof topic !== "string" || !topic.trim()) return;
	if (typeof event !== "string" || !event.trim()) return;

	const channel = sb.channel(topic.trim(), { config: { private: true } });
	let sent = false;

	try {
		await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("Realtime subscribe timeout"));
			}, 12000);

			channel.subscribe((status, err) => {
				if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED && !sent) {
					sent = true;
					clearTimeout(timeout);
					channel
						.send({
							type: "broadcast",
							event: event.trim(),
							payload: payload && typeof payload === "object" ? payload : {}
						})
						.then((r) => {
							if (r !== "ok") reject(new Error(`broadcast send: ${r}`));
							else resolve();
						})
						.catch(reject);
					return;
				}
				if (
					status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
					status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT ||
					status === REALTIME_SUBSCRIBE_STATES.CLOSED
				) {
					if (!sent) {
						clearTimeout(timeout);
						reject(err || new Error(String(status)));
					}
				}
			});
		});
	} catch (err) {
		console.warn("[realtime broadcast]", err?.message || err);
	} finally {
		try {
			await sb.removeChannel(channel);
		} catch {
			// ignore
		}
	}
}

/**
 * Invalidation hint after a chat message is stored: `room:<threadId>` + event `dirty`.
 */
export async function broadcastRoomDirty(threadId, messageId) {
	const tid = Number(threadId);
	const mid = Number(messageId);
	if (!Number.isFinite(tid) || tid <= 0 || !Number.isFinite(mid) || mid <= 0) return;

	await broadcastToChannel({
		topic: `room:${tid}`,
		event: "dirty",
		payload: {
			roomId: String(tid),
			afterMessageId: String(mid)
		}
	});
}

/**
 * Inbox / thread-list invalidation for each member (minimal payload; API is authoritative).
 * @param {number} threadId
 * @param {number[]} memberUserIds — `prsn_users.id` values
 */
export async function broadcastUserInboxDirty(threadId, memberUserIds) {
	const tid = Number(threadId);
	if (!Number.isFinite(tid) || tid <= 0) return;
	const ids = [
		...new Set(
			(memberUserIds || [])
				.map(Number)
				.filter((n) => Number.isFinite(n) && n > 0)
		)
	];
	for (const uid of ids) {
		void broadcastToChannel({
			topic: `user:${uid}`,
			event: "dirty",
			payload: { threadId: String(tid) }
		});
	}
}

/**
 * After a full thread removal: notify anyone on `room:<id>` and refresh member inboxes.
 */
export async function broadcastChatThreadDeleted(threadId, memberUserIds) {
	const tid = Number(threadId);
	if (!Number.isFinite(tid) || tid <= 0) return;

	await broadcastToChannel({
		topic: `room:${tid}`,
		event: "deleted",
		payload: { threadId: String(tid) }
	});
	await broadcastUserInboxDirty(threadId, memberUserIds);
}
