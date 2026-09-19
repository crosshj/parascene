import { notifyCreditPurchase } from "../api_routes/utils/purchaseNotify.js";
import { resolveNotificationDisplay } from "../api_routes/utils/notificationResolver.js";

describe("notifyCreditPurchase", () => {
	it("inserts a credits notification for a pack", async () => {
		const calls = [];
		const queries = {
			insertNotification: {
				run: async (...args) => {
					calls.push(args);
					return { insertId: 1, changes: 1 };
				}
			}
		};
		await notifyCreditPurchase(queries, { userId: "42", kind: "topup", credits: 300 });
		expect(calls).toHaveLength(1);
		expect(calls[0][2]).toBe("Credits added");
		expect(calls[0][3]).toBe("You received 300 credits.");
		expect(calls[0][6]).toBe("credits");
		expect(calls[0][8]).toEqual({ kind: "topup", credits: 300 });
	});

	it("welcomes Founder with first-payout copy", async () => {
		const calls = [];
		const queries = {
			insertNotification: {
				run: async (...args) => {
					calls.push(args);
					return { insertId: 1, changes: 1 };
				}
			}
		};
		await notifyCreditPurchase(queries, { userId: "42", kind: "founder", credits: 700 });
		expect(calls[0][2]).toBe("Welcome to Founder");
		expect(calls[0][3]).toBe("You're a Founder. 700 credits have been added to your account.");
		expect(calls[0][8]).toEqual({ kind: "founder", credits: 700 });
	});

	it("notifies monthly Founder renewals without sending email copy", async () => {
		const calls = [];
		const queries = {
			insertNotification: {
				run: async (...args) => {
					calls.push(args);
					return { insertId: 1, changes: 1 };
				}
			},
			selectUserById: {
				get: async () => {
					throw new Error("renewal should not load the user for email");
				}
			}
		};
		await notifyCreditPurchase(queries, { userId: "42", kind: "founder_renewal", credits: 700 });
		expect(calls[0][2]).toBe("Credits added");
		expect(calls[0][3]).toBe("Your 700 monthly Founder credits have been added.");
	});
});

describe("resolveNotificationDisplay credits", () => {
	it("rebuilds founder welcome from meta", async () => {
		const r = await resolveNotificationDisplay({
			type: "credits",
			meta: { kind: "founder", credits: 700 }
		}, {});
		expect(r.title).toBe("Welcome to Founder");
		expect(r.message).toContain("700 credits");
		expect(r.link).toBe("/pricing");
	});

	it("rebuilds pack copy from meta", async () => {
		const r = await resolveNotificationDisplay({
			type: "credits",
			meta: { kind: "topup", credits: 100 }
		}, {});
		expect(r.title).toBe("Credits added");
		expect(r.message).toBe("You received 100 credits.");
	});
});
