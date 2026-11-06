import { describe, expect, test } from "@jest/globals";
import {
	ephemeralStillPath,
	mintStillFetchToken,
	mintStillUploadTicket,
	stillTokenFromUrl,
	verifyStillFetchToken,
	verifyStillUploadTicket,
	resolveEphemeralStillProviderArgs
} from "../api_routes/utils/importEphemeralStill.js";

const OBJECT_ID = "o_0123456789abcdef01234567";

describe("ephemeral still tickets", () => {
	test("upload ticket round-trips for the same user", () => {
		const ticket = mintStillUploadTicket({
			userId: 7,
			objectId: OBJECT_ID,
			contentType: "image/jpeg",
			filename: "first.jpg"
		});
		const claimed = verifyStillUploadTicket(ticket, { userId: 7 });
		expect(claimed.userId).toBe(7);
		expect(claimed.objectId).toBe(OBJECT_ID);
		expect(claimed.kind).toBe("up");
	});

	test("fetch token is not a valid upload ticket", () => {
		const token = mintStillFetchToken({
			userId: 7,
			objectId: OBJECT_ID,
			contentType: "image/jpeg",
			filename: "first.jpg"
		});
		expect(() => verifyStillUploadTicket(token, { userId: 7 })).toThrow(/invalid/i);
		const claimed = verifyStillFetchToken(token, { userId: 7 });
		expect(claimed.kind).toBe("st");
	});

	test("rejects another user's ticket", () => {
		const ticket = mintStillUploadTicket({
			userId: 7,
			objectId: OBJECT_ID,
			contentType: "image/jpeg",
			filename: "first.jpg"
		});
		expect(() => verifyStillUploadTicket(ticket, { userId: 8 })).toThrow(/another user/i);
	});

	test("rejects an expired ticket", () => {
		const ticket = mintStillUploadTicket({
			userId: 7,
			objectId: OBJECT_ID,
			contentType: "image/jpeg",
			filename: "first.jpg",
			exp: Date.now() - 1000
		});
		expect(() => verifyStillUploadTicket(ticket, { userId: 7 })).toThrow(/expired/i);
	});

	test("parses still_url tokens", () => {
		const token = mintStillFetchToken({
			userId: 7,
			objectId: OBJECT_ID,
			contentType: "image/jpeg",
			filename: "first.jpg"
		});
		expect(stillTokenFromUrl(ephemeralStillPath(token))).toBe(token);
		expect(
			stillTokenFromUrl(`https://www.parascene.com${ephemeralStillPath(token)}`)
		).toBe(token);
		expect(stillTokenFromUrl("https://cdn.example/25019.png")).toBe("");
	});
});

describe("resolveEphemeralStillProviderArgs", () => {
	test("no-ops when no ephemeral still is present", async () => {
		const out = await resolveEphemeralStillProviderArgs({
			input_images: ["https://www.parascene.com/x.png"]
		});
		expect(out.ok).toBe(true);
		expect(out.handled).toBe(false);
		expect(out.args.input_images[0]).toBe("https://www.parascene.com/x.png");
	});

	test("rewrites still_url to a minted Blue fetch", async () => {
		const token = mintStillFetchToken({
			userId: 7,
			objectId: OBJECT_ID,
			contentType: "image/jpeg",
			filename: "first.jpg"
		});
		const stillUrl = `https://www.parascene.com${ephemeralStillPath(token)}`;
		const out = await resolveEphemeralStillProviderArgs(
			{ input_images: [stillUrl], image_url: stillUrl },
			{
				userId: 7,
				mintFetch: async (objectId) => {
					expect(objectId).toBe(OBJECT_ID);
					return { url: "https://blue.parascene.com/cdn/x?sig=1" };
				}
			}
		);
		expect(out.ok).toBe(true);
		expect(out.handled).toBe(true);
		expect(out.args.input_images[0]).toBe("https://blue.parascene.com/cdn/x?sig=1");
		expect(out.args.image_url).toBe("https://blue.parascene.com/cdn/x?sig=1");
	});
});
