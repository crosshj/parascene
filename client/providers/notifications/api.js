import { ApiError, requestJson } from '../../core/request.js';

export function createNotificationsApi() {
	return {
		async unreadCount({ signal } = {}) {
			const data = await requestJson('/api/notifications/unread-count', { signal });
			if (!Number.isFinite(Number(data?.count)) || !Number.isFinite(Number(data?.viewer_id))) {
				throw new ApiError('The notification count was incomplete. Try again.');
			}
			const count = Math.max(0, Number(data.count));
			const attention = Number.isFinite(Number(data.attention)) ? Math.max(0, Number(data.attention)) : count;
			return {
				count,
				attention,
				items: Array.isArray(data.items) ? data.items : [],
				skipped: Array.isArray(data.skipped) ? data.skipped : [],
				viewerId: Number(data.viewer_id),
			};
		},
		async list({ signal, limit = 100 } = {}) {
			const data = await requestJson(`/api/notifications?${new URLSearchParams({ limit: String(limit) })}`, { signal });
			if (!Array.isArray(data?.notifications) || !Number.isFinite(Number(data?.viewer_id))) {
				throw new ApiError('The notification list was incomplete. Try again.');
			}
			return { notifications: data.notifications, viewerId: Number(data.viewer_id) };
		},
		acknowledge(id) {
			return requestJson('/api/notifications/acknowledge', { method: 'POST', body: { id } });
		},
		acknowledgeAll() {
			return requestJson('/api/notifications/acknowledge-all', { method: 'POST', body: {} });
		},
	};
}
