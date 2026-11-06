import { describe, expect, test } from "@jest/globals";
import { mintShareToken, ACTIVE_SHARE_VERSION } from "../api_routes/utils/shareLink.js";
import {
	postedTextReferencesCreation,
	canViewUnpublishedCreationViaPostedRef,
} from "../api_routes/utils/postedCreationAccess.js";

describe("postedTextReferencesCreation", () => {
	test("matches creation paths and share urls", () => {
		expect(postedTextReferencesCreation("see /creations/30717 tonight", 30717)).toBe(true);
		expect(postedTextReferencesCreation("https://www.parascene.com/creations/9", 9)).toBe(true);
		expect(postedTextReferencesCreation("nope /creations/8", 9)).toBe(false);
		const token = mintShareToken({
			version: ACTIVE_SHARE_VERSION,
			imageId: 30717,
			sharedByUserId: 4,
		});
		expect(postedTextReferencesCreation(`https://sh.parascene.com/s/${ACTIVE_SHARE_VERSION}/${token}/abc`, 30717)).toBe(
			true
		);
		expect(postedTextReferencesCreation(`https://sh.parascene.com/s/${ACTIVE_SHARE_VERSION}/${token}/abc`, 1)).toBe(
			false
		);
	});
});

describe("canViewUnpublishedCreationViaPostedRef", () => {
	test("accepts a valid share token", async () => {
		const token = mintShareToken({
			version: ACTIVE_SHARE_VERSION,
			imageId: 12,
			sharedByUserId: 3,
		});
		const result = await canViewUnpublishedCreationViaPostedRef({
			image: { id: 12, status: "completed" },
			userId: 9,
			shareVersion: ACTIVE_SHARE_VERSION,
			shareToken: token,
		});
		expect(result).toMatchObject({ ok: true, via: "share" });
	});

	test("accepts a chat message the viewer can see", async () => {
		const sb = {
			from(table) {
				if (table === "prsn_chat_messages") {
					return {
						select() {
							return this;
						},
						eq() {
							return this;
						},
						maybeSingle: async () => ({
							data: { id: 88, thread_id: 5, body: "look /creations/12" },
							error: null,
						}),
					};
				}
				if (table === "prsn_chat_members") {
					return {
						select() {
							return this;
						},
						eq() {
							return this;
						},
						maybeSingle: async () => ({ data: { user_id: 9 }, error: null }),
					};
				}
				throw new Error(table);
			},
		};
		const result = await canViewUnpublishedCreationViaPostedRef({
			sb,
			image: { id: 12, status: "completed" },
			userId: 9,
			chatMessageId: 88,
		});
		expect(result).toMatchObject({ ok: true, via: "chat_message", chatMessageId: 88 });
	});

	test("rejects a chat message the viewer cannot see", async () => {
		const sb = {
			from(table) {
				if (table === "prsn_chat_messages") {
					return {
						select() {
							return this;
						},
						eq() {
							return this;
						},
						maybeSingle: async () => ({
							data: { id: 88, thread_id: 5, body: "look /creations/12" },
							error: null,
						}),
					};
				}
				if (table === "prsn_chat_members") {
					return {
						select() {
							return this;
						},
						eq() {
							return this;
						},
						maybeSingle: async () => ({ data: null, error: null }),
					};
				}
				throw new Error(table);
			},
		};
		const result = await canViewUnpublishedCreationViaPostedRef({
			sb,
			image: { id: 12, status: "completed" },
			userId: 9,
			chatMessageId: 88,
		});
		expect(result.ok).toBe(false);
	});
});
