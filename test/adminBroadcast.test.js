import {
	buildAdminBroadcastEmailData,
	filterAdminBroadcastRecipients,
	getAdminBroadcastRecipientName,
	isAdminBroadcastEligible,
	parseAdminBroadcastBody
} from "../api_routes/utils/adminBroadcast.js";

describe("adminBroadcast", () => {
	test("isAdminBroadcastEligible excludes admin and suspended", () => {
		expect(
			isAdminBroadcastEligible({
				role: "consumer",
				suspended: false,
				email: "a@b.co"
			})
		).toBe(true);
		expect(
			isAdminBroadcastEligible({
				role: "admin",
				suspended: false,
				email: "a@b.co"
			})
		).toBe(false);
		expect(
			isAdminBroadcastEligible({
				role: "consumer",
				suspended: true,
				email: "a@b.co"
			})
		).toBe(false);
		expect(
			isAdminBroadcastEligible({
				role: "consumer",
				suspended: false,
				email: "not-an-email"
			})
		).toBe(false);
	});

	test("filterAdminBroadcastRecipients", () => {
		const users = [
			{ id: 1, role: "consumer", suspended: false, email: "one@x.com" },
			{ id: 2, role: "admin", suspended: false, email: "admin@x.com" },
			{ id: 3, role: "consumer", suspended: true, email: "bad@x.com" }
		];
		expect(filterAdminBroadcastRecipients(users).map((u) => u.id)).toEqual([1]);
	});

	test("getAdminBroadcastRecipientName prefers @username", () => {
		expect(
			getAdminBroadcastRecipientName({
				user_name: "alex",
				display_name: "Alex",
				email: "a@b.co"
			})
		).toBe("@alex");
		expect(
			getAdminBroadcastRecipientName({
				display_name: "Alex",
				email: "a@b.co"
			})
		).toBe("Alex");
	});

	test("parseAdminBroadcastBody validates CTA URL", () => {
		expect(parseAdminBroadcastBody({}).ok).toBe(false);
		const ok = parseAdminBroadcastBody({
			emailSubject: "Hi",
			message: "Body",
			ctaText: "Go",
			ctaUrl: "https://example.com/x"
		});
		expect(ok.ok).toBe(true);
		expect(ok.data.headline).toBe("Hi");
	});

	test("buildAdminBroadcastEmailData merges shared fields", () => {
		const data = buildAdminBroadcastEmailData(
			{ user_name: "sam", email: "s@x.com" },
			{ emailSubject: "Sub", message: "M", ctaText: "T", ctaUrl: "https://x.com" }
		);
		expect(data.recipientName).toBe("@sam");
		expect(data.emailSubject).toBe("Sub");
	});
});
