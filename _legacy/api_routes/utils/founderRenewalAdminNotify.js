import { sendTemplatedEmail } from "../../email/index.js";

/** Same inbox as feature requests / support reports. */
export const ADMIN_OPS_EMAIL = "parascene.admin@crosshj.com";

/**
 * Best-effort admin email when Stripe subscription_cycle should trigger a Founder credit payout.
 * Never throws — webhook flow must not fail because mail delivery failed.
 *
 * @param {object} payload
 * @param {"success"|"failed"} payload.status
 * @param {string} [payload.reason]
 * @param {string|number|null} [payload.userId]
 * @param {string} [payload.userEmail]
 * @param {string} [payload.userName]
 * @param {string} [payload.displayName]
 * @param {string} [payload.subscriptionId]
 * @param {string} [payload.invoiceId]
 * @param {number} [payload.credits]
 * @param {number|null} [payload.amountPaidCents]
 * @param {string} [payload.eventId]
 */
export async function notifyAdminFounderRenewalPayout(payload = {}) {
	if (!process.env.RESEND_API_KEY || !process.env.RESEND_SYSTEM_EMAIL) {
		console.error("[founderRenewalAdminNotify] email not configured; skipped admin alert");
		return { sent: false, reason: "email_not_configured" };
	}
	try {
		await sendTemplatedEmail({
			to: ADMIN_OPS_EMAIL,
			template: "founderRenewalAdmin",
			data: {
				status: payload.status === "success" ? "success" : "failed",
				reason: payload.reason || "",
				userId: payload.userId ?? null,
				userEmail: payload.userEmail || "",
				userName: payload.userName || "",
				displayName: payload.displayName || "",
				subscriptionId: payload.subscriptionId || "",
				invoiceId: payload.invoiceId || "",
				credits: payload.credits,
				amountPaidCents: payload.amountPaidCents ?? null,
				eventId: payload.eventId || "",
				occurredAt: new Date().toISOString()
			}
		});
		return { sent: true };
	} catch (err) {
		console.error("[founderRenewalAdminNotify] send failed:", err?.message || err);
		return { sent: false, reason: err?.message || "send_failed" };
	}
}
