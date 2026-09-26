import { ApiError, requestJson } from '../core/request.js';

export function createSidebarApi() {
	return {
		load({ signal, current } = {}) {
			return Promise.all([
				requestJson('/api/chat/threads', { signal }),
				requestJson('/api/servers', { signal }),
				requestJson('/api/chat/unread-summary', { signal })
			]).then(([threads, servers, unreadSummary]) => {
				if (!Number.isFinite(Number(threads?.viewer_id)) || !Array.isArray(threads?.threads) || !Array.isArray(servers?.servers) || !Number.isFinite(Number(unreadSummary?.viewer_id)) || !Number.isFinite(Number(unreadSummary?.challenges_unread))) {
					throw new ApiError('The sidebar response was incomplete. Try refreshing.');
				}
				const readMarkers = { ...(current?.readMarkers || {}) };
				const mergedThreads = (Array.isArray(threads.threads) ? threads.threads : []).map((row) => {
					const marker = readMarkers[String(row.id)];
					if (!Number.isFinite(Number(marker))) return row;
					const latestMessageId = Number(row.last_message?.id) || 0;
					if (latestMessageId > Number(marker)) { delete readMarkers[String(row.id)]; return row; }
					return { ...row, unread_count: 0, last_read_message_id: Number(marker) || null };
				});
				return ({
				viewerId: Number(threads.viewer_id),
				threads: mergedThreads,
				servers: Array.isArray(servers.servers) ? servers.servers : [],
				viewerIsAdmin: threads.viewer_is_admin === true,
				unreadSummary,
				pinnedIds: Array.isArray(current?.pinnedIds) ? current.pinnedIds : [],
				hiddenIds: Array.isArray(current?.hiddenIds) ? current.hiddenIds : [],
				readMarkers
				});
			});
		}
	};
}
