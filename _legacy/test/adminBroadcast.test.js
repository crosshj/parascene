import {
	buildAdminBroadcastEmailData,
	filterAdminBroadcastRecipients,
	getAdminBroadcastRecipientName,
	isAdminBroadcastEligible,
	parseAdminBroadcastBody
} from "../api_routes/utils/adminBroadcast.js";
import { renderEmailTemplate } from "../email/index.js";

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

	test("admin broadcast renders emphasis and keeps one greeting", () => {
		const { html, text, subject } = renderEmailTemplate("adminBroadcast", {
			recipientName: "@sam",
			emailSubject: "Want your work featured on the Parascene homepage?",
			message: "Hello there.\n\n**And we'd love to feature some of YOUR work!**",
			ctaText: "Message oceanman",
			ctaUrl: "https://www.parascene.com/chat/dm/oceanman"
		});
		expect(subject).toBe("Want your work featured on the Parascene homepage?");
		expect(html).toContain("<strong>And we&#39;d love to feature some of YOUR work!</strong>");
		expect(html).not.toContain("**");
		expect(html).toContain("Hi @sam,");
		expect(text).toContain("And we'd love to feature some of YOUR work!");
		expect(text).not.toContain("**");
		expect(text).toContain("https://www.parascene.com/chat/dm/oceanman");
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
