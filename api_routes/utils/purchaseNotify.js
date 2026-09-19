import { sendTemplatedEmail } from "../../email/index.js";
import { getEffectiveEmailRecipient } from "./emailSettings.js";

function recipientName(user) {
	const display = typeof user?.display_name === "string" ? user.display_name.trim() : "";
	if (display) return display;
	const handle = typeof user?.user_name === "string" ? user.user_name.trim() : "";
	if (handle) return handle;
	const email = typeof user?.email === "string" ? user.email.trim() : "";
	if (email.includes("@")) return email.split("@")[0];
	return "there";
}

function copyForKind(kind, credits) {
	const amount = Math.round(Number(credits) || 0);
	if (kind === "founder") {
		return {
			title: "Welcome to Founder",
			message: `You're a Founder. ${amount} credits have been added to your account.`,
			template: "founderWelcome",
			emailData: { credits: amount }
		};
	}
	if (kind === "founder_renewal") {
		return {
			title: "Credits added",
			message: `Your ${amount} monthly Founder credits have been added.`,
			template: null,
			emailData: null
		};
	}
	return {
		title: "Credits added",
		message: `You received ${amount} credits.`,
		template: "creditTopup",
		emailData: { credits: amount }
	};
}

/**
 * Best-effort in-app notification and email after a paid credit grant.
 * @param {object} queries
 * @param {{ userId: string, kind: "topup" | "founder" | "founder_renewal", credits: number }} opts
 */
export async function notifyCreditPurchase(queries, { userId, kind, credits }) {
	if (!userId) return;
	const copy = copyForKind(kind, credits);
	try {
		if (queries.insertNotification?.run) {
			await queries.insertNotification.run(
				userId,
				null,
				copy.title,
				copy.message,
				"/pricing",
				null,
				"credits",
				null,
				{ kind, credits: Math.round(Number(credits) || 0) }
			);
		}
	} catch (err) {
		console.error("[purchaseNotify] notification failed:", err?.message || err);
	}

	if (!copy.template) return;
	if (!process.env.RESEND_API_KEY || !process.env.RESEND_SYSTEM_EMAIL) return;
	try {
		const user = await queries.selectUserById?.get?.(userId);
		const email = typeof user?.email === "string" ? user.email.trim() : "";
		if (!email || !email.includes("@")) return;
		const to = await getEffectiveEmailRecipient(queries, email);
		await sendTemplatedEmail({
			to,
			template: copy.template,
			data: { recipientName: recipientName(user), ...copy.emailData }
		});
	} catch (err) {
		console.error("[purchaseNotify] email failed:", err?.message || err);
	}
}
