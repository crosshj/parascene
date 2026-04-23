import { describe, it, expect } from "@jest/globals";
import { pathnameChatOpenForViewer } from "../api_routes/utils/chatDeepLinks.js";

describe("pathnameChatOpenForViewer", () => {
	it("uses /chat/c/slug for channels", () => {
		expect(
			pathnameChatOpenForViewer({
				threadId: 99,
				threadType: "channel",
				channelSlug: "feedback",
				dmPairKey: null,
				viewerUserId: 1,
				otherUserProfile: null
			})
		).toBe("/chat/c/feedback");
	});

	it("uses /chat/dm/handle when DM and username fits path rules", () => {
		expect(
			pathnameChatOpenForViewer({
				threadId: 5,
				threadType: "dm",
				channelSlug: null,
				dmPairKey: "1:2",
				viewerUserId: 1,
				otherUserProfile: { user_name: "jordan" }
			})
		).toBe("/chat/dm/jordan");
	});

	it("uses /chat/dm/numeric id for DM without username", () => {
		expect(
			pathnameChatOpenForViewer({
				threadId: 5,
				threadType: "dm",
				channelSlug: null,
				dmPairKey: "1:2",
				viewerUserId: 1,
				otherUserProfile: null
			})
		).toBe("/chat/dm/2");
	});

	it("falls back to /chat/t/id when type unknown", () => {
		expect(
			pathnameChatOpenForViewer({
				threadId: 42,
				threadType: "",
				channelSlug: null,
				dmPairKey: null,
				viewerUserId: 1,
				otherUserProfile: null
			})
		).toBe("/chat/t/42");
	});
});
