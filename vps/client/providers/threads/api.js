import { ApiError, requestJson } from '../../core/request.js';

export function createThreadsApi() {
	return {
		async loadInbox({ signal } = {}) {
			const [threads, servers, unreadSummary] = await Promise.all([
				requestJson('/api/chat/threads', { signal }),
				requestJson('/api/servers', { signal }),
				requestJson('/api/chat/unread-summary', { signal })
			]);
			if (
				!Number.isFinite(Number(threads?.viewer_id)) ||
				!Array.isArray(threads?.threads) ||
				!Array.isArray(servers?.servers) ||
				!Number.isFinite(Number(unreadSummary?.viewer_id)) ||
				!Number.isFinite(Number(unreadSummary?.challenges_unread))
			) {
				throw new ApiError('The threads inbox response was incomplete. Try refreshing.');
			}
			return {
				viewerId: Number(threads.viewer_id),
				threads: threads.threads,
				servers: servers.servers.filter((row) => row?.is_member),
				viewerIsAdmin: threads.viewer_is_admin === true,
				viewerIsFounder: threads.viewer_is_founder === true,
				unreadSummary
			};
		},
		loadCanvases(threadId, options = {}) { return requestJson(`/api/chat/threads/${threadId}/canvases`, options); },
		createCanvas(threadId, payload, options = {}) { return requestJson(`/api/chat/threads/${threadId}/canvases`, { ...options, method: 'POST', body: payload }); },
		pinCanvas(threadId, messageId, options = {}) { return requestJson(`/api/chat/threads/${threadId}/pinned-canvas`, { ...options, method: 'POST', body: { message_id: messageId } }); },
		loadMembers(threadId, options = {}) { return requestJson(`/api/chat/threads/${threadId}/member-status`, options); },
		getThread(threadId, options = {}) {
			return requestJson(`/api/chat/threads/${encodeURIComponent(threadId)}`, options);
		},
		openChannel(tag, options = {}) {
			return requestJson('/api/chat/channels', { ...options, method: 'POST', body: { tag } });
		},
		async loadMessages(threadId, { limit = 40, before, signal } = {}) {
			const query = new URLSearchParams({ limit: String(limit) });
			if (before) query.set('before', String(before));
			const data = await requestJson(`/api/chat/threads/${encodeURIComponent(threadId)}/messages?${query}`, { signal });
			if (!Array.isArray(data?.messages) || typeof data?.hasMore !== 'boolean') {
				throw new ApiError('The messages response was incomplete. Try refreshing.');
			}
			return {
				messages: Array.isArray(data?.messages) ? data.messages : [],
				hasMore: data?.hasMore === true,
				nextBefore: typeof data?.nextBefore === 'string' ? data.nextBefore : null,
			};
		},
		sendMessage(threadId, payload, options = {}) {
			return requestJson(`/api/chat/threads/${encodeURIComponent(threadId)}/messages`, { ...options, method: 'POST', body: payload });
		},
		markRead(threadId, messageId, options = {}) {
			return requestJson(`/api/chat/threads/${encodeURIComponent(threadId)}/read`, { ...options, method: 'POST', body: { last_read_message_id: messageId } });
		},
		editMessage(messageId, payload, options = {}) {
			return requestJson(`/api/chat/messages/${encodeURIComponent(messageId)}`, { ...options, method: 'PATCH', body: payload });
		},
		deleteMessage(messageId, options = {}) {
			return requestJson(`/api/chat/messages/${encodeURIComponent(messageId)}`, { ...options, method: 'DELETE' });
		},
		saveChallengeVote(messageId, payload, options = {}) {
			return requestJson(`/api/chat/messages/${encodeURIComponent(messageId)}/challenge-vote`, { ...options, method: 'PUT', body: payload });
		},
		toggleReaction(messageId, emoji, options = {}) {
			return requestJson(`/api/chat/messages/${encodeURIComponent(messageId)}/reactions`, { ...options, method: 'POST', body: { emoji_key: emoji } });
		},
		markThreadHidden(threadId, options = {}) {
			return requestJson(`/api/chat/threads/${encodeURIComponent(threadId)}/hide`, { ...options, method: 'POST', body: {} });
		},
		leaveThread(threadId, options = {}) {
			return requestJson(`/api/chat/threads/${encodeURIComponent(threadId)}/leave`, { ...options, method: 'POST', body: {} });
		},
		getPrivateKey(threadId, options = {}) {
			return requestJson(`/api/chat/threads/${encodeURIComponent(threadId)}/private-key`, options);
		},
		getUnreadSummary(options = {}) {
			return requestJson('/api/chat/unread-summary', options);
		},
	};
}
