import { renderEmailTemplate } from "../email/index.js";
import { notifyAdminFounderRenewalPayout } from "../api_routes/utils/founderRenewalAdminNotify.js";

describe("founderRenewalAdmin email", () => {
	it("renders a success admin alert", () => {
		const { subject, text } = renderEmailTemplate("founderRenewalAdmin", {
			status: "success",
			userId: 218,
			userEmail: "batch08@gmail.com",
			userName: "seafoodboba19",
			displayName: "Alley One",
			subscriptionId: "sub_abc",
			invoiceId: "in_abc",
			credits: 700,
			amountPaidCents: 1200,
			eventId: "evt_abc"
		});
		expect(subject).toContain("Founder renewal paid out");
		expect(text).toContain("Granted 700 Founder renewal credits.");
		expect(text).toContain("@seafoodboba19");
		expect(text).toContain("in_abc");
		expect(text).toContain("$12.00");
	});

	it("renders a failure admin alert", () => {
		const { subject, text } = renderEmailTemplate("founderRenewalAdmin", {
			status: "failed",
			reason: "subscription_cycle invoice missing subscription id",
			invoiceId: "in_fail",
			subscriptionId: "",
			credits: 700
		});
		expect(subject).toBe("Founder renewal payout failed");
		expect(text).toContain("subscription_cycle invoice missing subscription id");
		expect(text).toContain("in_fail");
	});
});

describe("notifyAdminFounderRenewalPayout", () => {
	const originalKey = process.env.RESEND_API_KEY;
	const originalFrom = process.env.RESEND_SYSTEM_EMAIL;

	afterEach(() => {
		if (originalKey == null) delete process.env.RESEND_API_KEY;
		else process.env.RESEND_API_KEY = originalKey;
		if (originalFrom == null) delete process.env.RESEND_SYSTEM_EMAIL;
		else process.env.RESEND_SYSTEM_EMAIL = originalFrom;
	});

	it("skips when email env is not configured", async () => {
		delete process.env.RESEND_API_KEY;
		delete process.env.RESEND_SYSTEM_EMAIL;
		const result = await notifyAdminFounderRenewalPayout({ status: "success", credits: 700 });
		expect(result).toEqual({ sent: false, reason: "email_not_configured" });
	});
});
