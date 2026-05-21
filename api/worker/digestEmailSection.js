import { resolveNotificationDisplay } from "../../api_routes/utils/notificationResolver.js";
import { filterNotificationsForBell } from "../../api_routes/utils/notificationBellFilter.js";
import { getBaseAppUrlForEmail } from "../../api_routes/utils/url.js";
import { buildChatDigestEmailSection } from "./chatDigestEmail.js";

const MAX_DIGEST_NOTIFICATION_LINES = 12;

/**
 * Build per-user digest lines from unread in-app notifications (actor-resolved copy + deep links).
 * @param {{ queries: object, userId: number, userRole?: string | null, sinceIso: string }} args
 */
export async function buildNotificationDigestLines({ queries, userId, userRole, sinceIso }) {
	const rows = filterNotificationsForBell(
		await (queries.selectNotificationsForUser?.all(userId, userRole ?? null, 50) ?? [])
	);
	const unread = rows.filter((row) => {
		if (row?.acknowledged_at) return false;
		const created = row?.created_at ? String(row.created_at) : "";
		return !sinceIso || created >= sinceIso;
	});

	const base = getBaseAppUrlForEmail().replace(/\/+$/, "");
	const items = [];

	for (const row of unread) {
		if (items.length >= MAX_DIGEST_NOTIFICATION_LINES) break;
		const resolved =
			typeof row?.type === "string" && row.type.trim()
				? await resolveNotificationDisplay(row, queries)
				: null;
		const title = (resolved?.title ?? row?.title ?? "Notification").trim();
		const message = (resolved?.message ?? row?.message ?? "").trim();
		const link = (resolved?.link ?? row?.link ?? "").trim();
		if (!title && !message) continue;
		const url = link.startsWith("/") ? `${base}${link}` : link || base;
		items.push({ title, message, url });
	}

	return items;
}

/**
 * DM unread threads for digest email — uses chat read state, not prsn_notifications
 * (avoids duplicating chat roster/unread badges with in-app notification rows).
 */
export async function buildDmChatDigestSection(args) {
	return buildChatDigestEmailSection({ ...args, dmOnly: true });
}
