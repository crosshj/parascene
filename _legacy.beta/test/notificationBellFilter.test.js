import { describe, it, expect } from "@jest/globals";
import {
	countUnreadNotificationsForBell,
	filterNotificationsForBell,
	isDmChatMentionNotification
} from "../api_routes/utils/notificationBellFilter.js";

describe("notificationBellFilter", () => {
	it("detects DM chat_mention via meta, target, or link", () => {
		expect(
			isDmChatMentionNotification({
				type: "chat_mention",
				meta: { thread_type: "dm" }
			})
		).toBe(true);
		expect(
			isDmChatMentionNotification({
				type: "chat_mention",
				link: "/chat/dm/someuser"
			})
		).toBe(true);
		expect(
			isDmChatMentionNotification({
				type: "chat_mention",
				meta: { thread_type: "channel" },
				link: "/chat/c/general"
			})
		).toBe(false);
		expect(isDmChatMentionNotification({ type: "comment", link: "/creations/1" })).toBe(false);
	});

	it("filters DM mentions out of bell list and count", () => {
		const rows = [
			{ type: "comment", acknowledged_at: null },
			{ type: "chat_mention", meta: { thread_type: "dm" }, acknowledged_at: null },
			{ type: "chat_mention", meta: { thread_type: "channel" }, acknowledged_at: null }
		];
		expect(filterNotificationsForBell(rows)).toHaveLength(2);
		expect(countUnreadNotificationsForBell(rows)).toBe(2);
	});
});
