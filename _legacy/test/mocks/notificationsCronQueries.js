import { jest } from "@jest/globals";


export function createNotificationsCronQueries(overrides = {}) {
	const insertEmailSendRun = jest.fn(async () => ({ changes: 1 }));
	const upsertWelcomeRun = jest.fn(async () => ({ changes: 1 }));

	const base = {
		// One user with unread notifications → eligible for digest.
		selectDistinctUserIdsWithUnreadNotificationsSince: {
			all: jest.fn(async () => [{ user_id: 1 }])
		},
		selectUserIdsWithChatDigestibleUnreadSince: {
			all: jest.fn(async () => [])
		},
		selectDigestChatUnreadThreadsSince: {
			all: jest.fn(async () => [])
		},
		selectUserById: {
			get: jest.fn(async (userId) => ({
				id: userId,
				email: "user@example.com",
				display_name: "User",
				user_name: "user",
				role: "consumer"
			}))
		},
		selectEmailSendsCountForUserSince: {
			get: jest.fn(async () => ({ count: 0 }))
		},
		selectNotificationsForUser: {
			all: jest.fn(async () => [
				{
					id: 10,
					acknowledged_at: null,
					link: "/creations/1",
					type: "comment",
					actor_user_id: 2,
					user_id: 1,
					target: { creation_id: 1 },
					meta: { creation_title: "Test creation" },
					created_at: new Date().toISOString(),
					title: "Comment",
					message: "Someone commented"
				}
			])
		},
		selectUserProfileByUserId: {
			get: jest.fn(async () => ({ display_name: "Commenter", user_name: "commenter" }))
		},
		// No re-engagement / highlight / welcome / nudge candidates for this test.
		selectUsersEligibleForReengagement: {
			all: jest.fn(async () => [])
		},
		selectCreationsEligibleForHighlight: {
			all: jest.fn(async () => [])
		},
		selectUsersEligibleForWelcomeEmail: {
			all: jest.fn(async () => [])
		},
		selectUsersEligibleForFirstCreationNudge: {
			all: jest.fn(async () => [])
		},
		selectPublishedNonWelcomeCreationCountForUser: {
			get: jest.fn(async () => ({ count: 0 }))
		},
		insertEmailSend: {
			run: insertEmailSendRun
		},
		upsertUserEmailCampaignStateLastDigest: {
			run: jest.fn(async () => ({ changes: 1 }))
		},
		upsertUserEmailCampaignStateWelcome: {
			run: upsertWelcomeRun
		},
		upsertUserEmailCampaignStateFirstCreationNudge: {
			run: jest.fn(async () => ({ changes: 1 }))
		},
		upsertUserEmailCampaignStateReengagement: {
			run: jest.fn(async () => ({ changes: 1 }))
		},
		upsertUserEmailCampaignStateCreationHighlight: {
			run: jest.fn(async () => ({ changes: 1 }))
		}
	};

	return { ...base, ...overrides };
}

