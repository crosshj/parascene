import { ApiError, requestJson } from '../../core/request.js';

export function createChatApi() {
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
				throw new ApiError('The chat inbox response was incomplete. Try refreshing.');
			}
			return {
				viewerId: Number(threads.viewer_id),
				threads: threads.threads,
				servers: servers.servers,
				viewerIsAdmin: threads.viewer_is_admin === true,
				unreadSummary
			};
		}
	};
}
