import { describe, it, expect, jest } from "@jest/globals";
import { insertNotificationsForChatMentions } from "../api_routes/utils/chatMentionNotifications.js";

describe("insertNotificationsForChatMentions", () => {
	it("does not insert bell notifications for DM threads", async () => {
		const run = jest.fn(async () => ({ insertId: 1, changes: 1 }));
		await insertNotificationsForChatMentions({
			queries: {
				insertNotification: { run },
				selectUserProfileByUsername: {
					get: jest.fn(async () => ({ user_id: 2 }))
				},
				selectNotificationsForUser: { all: jest.fn(async () => []) }
			},
			memberUserIds: [1, 2],
			threadId: 99,
			threadType: "dm",
			channelSlug: null,
			dmPairKey: "1:2",
			senderId: 1,
			body: "hey @otheruser"
		});
		expect(run).not.toHaveBeenCalled();
	});

	it("inserts for @mention in a channel thread", async () => {
		const run = jest.fn(async () => ({ insertId: 1, changes: 1 }));
		await insertNotificationsForChatMentions({
			queries: {
				insertNotification: { run },
				selectUserProfileByUsername: {
					get: jest.fn(async (handle) =>
						handle === "otheruser" ? { user_id: 2 } : undefined
					)
				},
				selectNotificationsForUser: { all: jest.fn(async () => []) }
			},
			memberUserIds: [1, 2],
			threadId: 10,
			threadType: "channel",
			channelSlug: "general",
			dmPairKey: null,
			senderId: 1,
			body: "hey @otheruser"
		});
		expect(run).toHaveBeenCalledTimes(1);
	});
});
