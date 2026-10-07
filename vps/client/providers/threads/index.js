import { outstandingChallengeVotes } from '../../shared/challenges/model/outstandingVotes.js';
import { mergeThreadsInbox } from './model.js';
import { createChallengeVotes } from '../challenges/votes.js';
import { createThreadsApi } from './api.js';
import { clearThreadMessagesCache, createThreadMessagesQuery, createThreadsInboxQuery } from './query.js';
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
	// Keep a small provider-scoped message window so route changes can paint
	// immediately, then revalidate through the same query on the next visit.
	const messageQueries = new Map();
	const canvasSnapshots = new Map();
	const MAX_CACHED_THREADS = 8;
	const MAX_CACHED_CANVASES = 16;
	let destroyed = false;
 const votes = createChallengeVotes({ viewerId,
  send: (messageId, payload, options) => api.saveChallengeVote(messageId, payload, options),
  onChange() {
   for (const cached of messageQueries.values()) if (cached.mode.complete && cached.lease.query.data) cached.lease.query.update(current => ({ ...current, messages: votes.project(current.messages) }), { updated: cached.lease.query.getSnapshot().updatedAt });
  },
  onSaved(threadId) { rooms.get(Number(threadId))?.refresh.request(); inboxRefresh?.request(); },
 });
	let challengeAttention = null;
	const attentionListeners = new Set();
	let stopChallengeAttentionInbox = null;
	let stopChallengeAttentionMessages = null;
	let challengeAttentionLease = null;
	function setChallengeAttention(count) {
		const next = count == null || !Number.isFinite(Number(count)) ? null : Math.max(0, Math.floor(Number(count)));
		if (Object.is(challengeAttention, next)) return;
		challengeAttention = next;
		for (const listener of attentionListeners) listener(next);
	}
	function challengeUnread(summary) {
		const server = Math.max(0, Number(summary?.challenges_unread) || 0);
		return typeof challengeAttention === 'number' && challengeAttention > 0 ? challengeAttention : server;
	}
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
	function publishChallengeAttention(snapshot) {
		if (destroyed || !snapshot?.data?.complete) return;
		setChallengeAttention(outstandingChallengeVotes(votes.project(snapshot.data.messages), viewerId));
	}
	function watchChallengeAttention() {
		if (stopChallengeAttentionInbox || !query) return;
		stopChallengeAttentionInbox = query.subscribe((snapshot) => {
			if (destroyed || challengeAttentionLease) return;
			const thread = snapshot?.data?.threads?.find((row) => row.channel_slug === 'challenges');
			if (!thread) return;
			challengeAttentionLease = provider.acquireMessages(Number(thread.id), { persist: true, complete: true });
			stopChallengeAttentionMessages = challengeAttentionLease.query.subscribe(publishChallengeAttention);
			void challengeAttentionLease.query.loadIfNeeded().catch(() => undefined);
		});
	}
	function destroy() {
		if (destroyed) return;
		destroyed = true;
		stopChallengeAttentionMessages?.();
		challengeAttentionLease?.release();
		stopChallengeAttentionInbox?.();
		votes.destroy(); stopInbox?.(); stopUser?.(); inboxRefresh?.destroy(); realtime?.destroy();
		for (const room of rooms.values()) { room.refresh.destroy(); room.unsubscribe(); }
		rooms.clear();
		for (const entry of messageQueries.values()) entry.lease.release();
		messageQueries.clear(); canvasSnapshots.clear();
		if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', resume);
		if (typeof window !== 'undefined') window.removeEventListener('online', resume);
	}

	const provider = {
		api,
		votes,
		query,
		preload() {
			watchChallengeAttention();
			if (query) void query.loadIfNeeded().catch(() => undefined);
		},
		get challengeAttention() { return challengeAttention; },
		setChallengeAttention,
		challengeUnread,
		subscribeChallengeAttention(listener) {
			attentionListeners.add(listener);
			return () => attentionListeners.delete(listener);
		},
		acquireMessages(threadId, { persist = false, complete = false } = {}) {
			if (destroyed) throw new Error('Threads provider has been destroyed');
			const key = Number(threadId);
			let cached = messageQueries.get(key);
			if (!cached) {
				const mode = { complete };
			cached = { mode, lease: createThreadMessagesQuery({ threadId, api, viewerId, persist, mode, reconcile: messages => votes.project(messages) }), refs: 0, touched: Date.now() };
				messageQueries.set(key, cached);
			}
			if (complete) cached.mode.complete = true;
			cached.refs++; cached.touched = Date.now();
			let room = rooms.get(key);
			if (!room) {
				const refresh = createQueryRefresh(cached.lease.query);
				const unsubscribe = realtime.subscribe(`room:${key}`, () => refresh.request(), { onDeleted: () => {
					inboxRefresh?.request();
					cached.lease.query.refresh({ force: true }).catch(() => undefined);
				} });
				room = { refs: 0, refresh, unsubscribe };
				rooms.set(key, room);
			}
			room.refs++;
			let released = false;
			return {
				query: cached.lease.query,
				release() {
					if (released) return;
					released = true;
					if (--room.refs === 0) { room.refresh.destroy(); room.unsubscribe(); rooms.delete(key); }
					cached.refs = Math.max(0, cached.refs - 1); cached.touched = Date.now();
					if (messageQueries.size > MAX_CACHED_THREADS) {
						for (const [id, entry] of [...messageQueries].sort((a, b) => a[1].touched - b[1].touched)) {
							if (messageQueries.size <= MAX_CACHED_THREADS) break;
							if (!entry.refs) { entry.lease.release(); messageQueries.delete(id); }
						}
					}
				},
			};
		},
		getCanvases(threadId) { return canvasSnapshots.get(Number(threadId)) || null; },
		async refreshCanvases(threadId, options = {}) {
			const key = Number(threadId);
			const data = await api.loadCanvases(key, options);
			if (!destroyed) {
				canvasSnapshots.delete(key); canvasSnapshots.set(key, data);
				while (canvasSnapshots.size > MAX_CACHED_CANVASES) canvasSnapshots.delete(canvasSnapshots.keys().next().value);
			}
			return data;
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
   query?.update(current => current ? mergeThreadsInbox(current, { ...current, readMarkers: { ...current.readMarkers, [String(threadId)]: response.last_read_message_id } }) : current);
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
		syncExternalCache(event) { inbox?.syncExternalCache(event); votes.syncExternalCache(event); },
		clearCache() { votes.clear(); inbox?.clearCache(); clearThreadMessagesCache(viewerId); destroy(); },
		destroy,
	};
	return provider;
}
