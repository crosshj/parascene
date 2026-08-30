import { describe, expect, test } from "@jest/globals";
import {
	mintAudioImportTicket,
	normalizeAudioContentType,
	normalizeAudioFilename,
	titleFromAudioFilename,
	verifyAudioImportTicket
} from "../api_routes/utils/importAudioFileCreation.js";
import { blueCdnOriginFromServerUrl, parseCdnWindowQuery } from "../api_routes/utils/blueCdn.js";

const OBJECT_ID = "o_0123456789abcdef01234567";

describe("audio import ticket", () => {
	test("round-trips for the same user", () => {
		const ticket = mintAudioImportTicket({
			userId: 7,
			objectId: OBJECT_ID,
			contentType: "audio/mpeg",
			filename: "song.mp3"
		});
		const claimed = verifyAudioImportTicket(ticket, { userId: 7 });
		expect(claimed.userId).toBe(7);
		expect(claimed.objectId).toBe(OBJECT_ID);
		expect(claimed.contentType).toBe("audio/mpeg");
		expect(claimed.filename).toBe("song.mp3");
	});

	test("rejects another user's ticket", () => {
		const ticket = mintAudioImportTicket({
			userId: 7,
			objectId: OBJECT_ID,
			contentType: "audio/mpeg",
			filename: "song.mp3"
		});
		expect(() => verifyAudioImportTicket(ticket, { userId: 8 })).toThrow(/another user/i);
	});

	test("rejects an expired ticket", () => {
		const ticket = mintAudioImportTicket({
			userId: 7,
			objectId: OBJECT_ID,
			contentType: "audio/mpeg",
			filename: "song.mp3",
			exp: Date.now() - 1000
		});
		expect(() => verifyAudioImportTicket(ticket, { userId: 7 })).toThrow(/expired/i);
	});

	test("rejects a tampered ticket", () => {
		const ticket = mintAudioImportTicket({
			userId: 7,
			objectId: OBJECT_ID,
			contentType: "audio/mpeg",
			filename: "song.mp3"
		});
		const [payload, sig] = ticket.split(".");
		expect(() => verifyAudioImportTicket(`${payload}x.${sig}`, { userId: 7 })).toThrow(/invalid/i);
	});
});

describe("audio import helpers", () => {
	test("strips paths from filenames", () => {
		expect(normalizeAudioFilename("../../secret/track.mp3")).toBe("track.mp3");
	});

	test("title comes from the stem", () => {
		expect(titleFromAudioFilename("My Song.mp3")).toBe("My Song");
	});

	test("normalizes content type", () => {
		expect(normalizeAudioContentType("audio/mpeg; charset=binary")).toBe("audio/mpeg");
	});
});

describe("blue CDN helpers", () => {
	test("origin from generate server_url", () => {
		expect(blueCdnOriginFromServerUrl("https://blue.parascene.com/api")).toBe(
			"https://blue.parascene.com"
		);
	});

	test("parseCdnWindowQuery empty", () => {
		expect(parseCdnWindowQuery(undefined, undefined)).toEqual({});
	});

	test("parseCdnWindowQuery so+du", () => {
		expect(parseCdnWindowQuery("1.5", "2")).toEqual({ so: 1.5, du: 2 });
	});

	test("parseCdnWindowQuery rejects bad du", () => {
		expect(() => parseCdnWindowQuery("0", "-1")).toThrow(/du/);
	});
});
