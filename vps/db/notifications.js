const NOTIFICATIONS_TABLE = "prsn_notifications";
const NOTIFICATION_FIELDS = "id, user_id, role, title, message, link, created_at, acknowledged_at, actor_user_id, type, target, meta";

function scoped(query, userId, role) {
	const clauses = [`user_id.eq.${Number(userId)}`];
	if (typeof role === "string" && role.trim()) clauses.push(`role.eq.${role.trim()}`);
	return query.or(clauses.join(","));
}

export function createNotificationsStore(client) {
	return {
		async list(userId, role, { limit = 25 } = {}) {
			const safeLimit = Math.min(200, Math.max(1, Number(limit) || 25));
			const { data, error } = await scoped(
				client.from(NOTIFICATIONS_TABLE).select(NOTIFICATION_FIELDS),
				userId,
				role
			).order("created_at", { ascending: false }).limit(safeLimit);
			if (error) throw error;
			return data || [];
		},

		async acknowledge(userId, role, id) {
			const notificationId = Number(id);
			if (!Number.isInteger(notificationId) || notificationId <= 0) return 0;
			const { data, error } = await scoped(
				client.from(NOTIFICATIONS_TABLE).update({ acknowledged_at: new Date().toISOString() }).eq("id", notificationId),
				userId,
				role
			).select("id");
			if (error) throw error;
			return data?.length || 0;
		},

		async acknowledgeAll(userId, role) {
			const { data, error } = await scoped(
				client.from(NOTIFICATIONS_TABLE).update({ acknowledged_at: new Date().toISOString() }).is("acknowledged_at", null),
				userId,
				role
			).select("id");
			if (error) throw error;
			return data?.length || 0;
		}
	};
}
