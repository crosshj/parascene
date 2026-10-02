import { createThreadsApi } from './api.js';
import { createThreadMessagesQuery, createThreadsInboxQuery } from './query.js';
import { encryptThreadText } from './private.js';
import { createThreadsRealtime } from './realtime.js';
import { createQueryRefresh } from './refresh.js';

export function createThreadsProvider({ viewerId, registry, realtimeFactory = createThreadsRealtime, apiFactory = createThreadsApi } = {}) {
	const api = apiFactory();
	const inbox = viewerId ? createThreadsInboxQuery({ viewerId, api }) : null;
	const lease = inbox ? registry.acquire(['threads-inbox', viewerId], () => inbox.query) : null;
	const query = lease?.query || null;
	const realtime = viewerId ? realtimeFactory({ viewerId }) : null;
	const inboxRefresh = query ? createQueryRefresh(query) : null;
	const rooms = new Map();
	let destroyed = false;
	let stopUser = null;
	const stopInbox = query?.subscribe((snapshot) => {
		if (snapshot.data && !stopUser && !destroyed) stopUser = realtime.subscribe(`user:${viewerId}`, () => inboxRefresh.request(), { debounceMs: 280 });
	});
	function resume() {
		if (destroyed || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
		realtime?.retry();
		inboxRefresh?.request();
		for (const room of rooms.values()) room.refresh.request();
	}
	if (typeof document !== 'undefined') document.addEventListener('visibilitychange', resume);
	if (typeof window !== 'undefined') window.addEventListener('online', resume);
	function destroy() {
		if (destroyed) return;
		destroyed = true;
		stopInbox?.(); stopUser?.(); inboxRefresh?.destroy(); realtime?.destroy();
		for (const room of rooms.values()) { room.refresh.destroy(); room.unsubscribe(); }
		rooms.clear();
		if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', resume);
		if (typeof window !== 'undefined') window.removeEventListener('online', resume);
	}

	return {
		api,
		query,
		preload() { if (query) void query.loadIfNeeded().catch(() => undefined); },
		acquireMessages(threadId) {
			if (destroyed) throw new Error('Threads provider has been destroyed');
			const acquired = createThreadMessagesQuery({ threadId, api, registry });
			const key = Number(threadId);
			let room = rooms.get(key);
			if (!room) {
				const refresh = createQueryRefresh(acquired.query);
				const unsubscribe = realtime.subscribe(`room:${key}`, () => refresh.request(), { onDeleted: () => {
					inboxRefresh?.request();
					acquired.query.refresh({ force: true }).catch(() => undefined);
				} });
				room = { refs: 0, refresh, unsubscribe };
				rooms.set(key, room);
			}
			room.refs++;
			let released = false;
			return {
				query: acquired.query,
				release() {
					if (released) return;
					released = true;
					if (--room.refs === 0) { room.refresh.destroy(); room.unsubscribe(); rooms.delete(key); }
					acquired.release();
				},
			};
		},
		async send(thread, body, reply) {
			let wire = body;
			if (thread.visibility === 'private') {
				const { k } = await api.getPrivateKey(thread.id);
				wire = await encryptThreadText(body, k);
			}
			const response = await api.sendMessage(thread.id, { body: wire, ...(reply ? { referenced_message_id: reply.referenced_id } : {}) });
			// Inbox refresh failure must not turn a committed send into a retry.
			void query?.refresh().catch(() => undefined);
			return response.message;
		},
		async markRead(threadId, messageId, options) {
			const response = await api.markRead(threadId, messageId, options);
			query?.update((current) => current ? {
				...current,
				readMarkers: { ...current.readMarkers, [String(threadId)]: response.last_read_message_id },
				threads: current.threads.map((row) => Number(row.id) === Number(threadId)
					? { ...row, last_read_message_id: response.last_read_message_id, unread_count: Number(row.last_message?.id) > Number(response.last_read_message_id) ? row.unread_count : 0 } : row),
			} : current);
			void query?.refresh().catch(() => undefined);
			return response;
		},
		async edit(thread, messageId, body) {
			let wire = body;
			if (thread.visibility === 'private') {
				const { k } = await api.getPrivateKey(thread.id);
				wire = await encryptThreadText(body, k);
			}
			const response = await api.editMessage(messageId, { body: wire });
			void query?.refresh().catch(() => undefined);
			return response.message;
		},
		async react(thread, messageId, emoji) {
			const response = await api.toggleReaction(messageId, emoji);
			rooms.get(Number(thread.id))?.refresh.request();
			return response;
		},
		async remove(thread, messageId) {
			const response = await api.deleteMessage(messageId);
			rooms.get(Number(thread.id))?.refresh.request(); inboxRefresh?.request();
			return response;
		},
		syncExternalCache(event) { inbox?.syncExternalCache(event); },
		clearCache() { inbox?.clearCache(); destroy(); },
		destroy,
	};
}
