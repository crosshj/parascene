import { getNotificationDisplayName } from "./displayName.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Active consumers eligible for admin broadcast (not admin, not suspended, valid email).
 * @param {Array<{ role?: string, suspended?: boolean, email?: string | null }>} users
 */
export function filterAdminBroadcastRecipients(users) {
	if (!Array.isArray(users)) return [];
	return users.filter((u) => isAdminBroadcastEligible(u));
}

export function isAdminBroadcastEligible(user) {
	if (!user || user.role !== "consumer" || user.suspended === true) return false;
	const email = typeof user.email === "string" ? user.email.trim() : "";
	return email.length > 0 && EMAIL_RE.test(email);
}

/**
 * Greeting name in broadcast emails (matches Manual Send picker for a single user).
 * @param {{ user_name?: string | null, display_name?: string | null, email?: string | null }} user
 */
export function getAdminBroadcastRecipientName(user) {
	const username = typeof user?.user_name === "string" ? user.user_name.trim() : "";
	if (username) return `@${username}`;
	return getNotificationDisplayName(user);
}

/**
 * @param {Record<string, unknown>} body
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
export function parseAdminBroadcastBody(body) {
	const emailSubject = typeof body?.emailSubject === "string" ? body.emailSubject.trim() : "";
	const message = typeof body?.message === "string" ? body.message.trim() : "";
	const ctaText = typeof body?.ctaText === "string" ? body.ctaText.trim() : "";
	const ctaUrl = typeof body?.ctaUrl === "string" ? body.ctaUrl.trim() : "";
	const headline =
		typeof body?.headline === "string" && body.headline.trim()
			? body.headline.trim()
			: emailSubject;

	if (!emailSubject) {
		return { ok: false, error: "Email subject is required for Admin broadcast." };
	}
	if (!message) {
		return { ok: false, error: "Message is required for Admin broadcast." };
	}
	if (!ctaText) {
		return { ok: false, error: "Button label is required for Admin broadcast." };
	}
	if (!ctaUrl || !/^https?:\/\//i.test(ctaUrl)) {
		return { ok: false, error: "Button URL must start with http:// or https://." };
	}

	return {
		ok: true,
		data: { emailSubject, headline, message, ctaText, ctaUrl }
	};
}

/**
 * @param {{ user_name?: string | null, display_name?: string | null, email?: string | null }} user
 * @param {object} shared
 */
export function buildAdminBroadcastEmailData(user, shared) {
	return {
		recipientName: getAdminBroadcastRecipientName(user),
		...shared
	};
}

/** Resend's default cap is 10 requests per second. Stay under it. */
export const ADMIN_BROADCAST_SEND_GAP_MS = 200;

export function isResendRateLimitError(error) {
	const message = String(error?.message || error || "");
	return /too many requests/i.test(message) || /\b429\b/.test(message);
}

/**
 * User ids that already have a recorded admin broadcast for this subject.
 * @param {Array<{ user_id?: number, meta?: { subject?: string } | null }>} rows
 * @param {string} subject
 */
export function userIdsAlreadySentAdminBroadcast(rows, subject) {
	const wanted = String(subject || "").trim();
	const ids = new Set();
	if (!wanted) return ids;
	for (const row of rows || []) {
		const metaSubject =
			row?.meta && typeof row.meta === "object" ? String(row.meta.subject || "").trim() : "";
		if (metaSubject === wanted && row.user_id != null) ids.add(Number(row.user_id));
	}
	return ids;
}

export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
