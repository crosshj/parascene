import { describe, expect, test, jest } from "@jest/globals";
import {
	creationMethodIsAudio,
	creationMethodMayReturnAudioBytes,
	extensionForAudioContentType,
	isVoiceTrainSuccessBody,
	persistGeneratedAudioToCdn,
} from "../api_routes/utils/persistGeneratedAudio.js";

describe("creationMethodIsAudio", () => {
	test("matches speech music and voice train methods", () => {
		expect(creationMethodIsAudio("replicateSpeech")).toBe(true);
		expect(creationMethodIsAudio("replicateMusic")).toBe(true);
		expect(creationMethodIsAudio("replicateVoiceTrain")).toBe(true);
		expect(creationMethodMayReturnAudioBytes("replicateSpeech")).toBe(true);
		expect(creationMethodIsAudio("replicate")).toBe(false);
		expect(creationMethodIsAudio("replicateVideo")).toBe(false);
	});
});

describe("isVoiceTrainSuccessBody", () => {
	test("requires voice_id", () => {
		expect(isVoiceTrainSuccessBody({ voice_id: "R8_FDU1SV5S" })).toBe(true);
		expect(isVoiceTrainSuccessBody({ status: "succeeded" })).toBe(false);
		expect(isVoiceTrainSuccessBody(null)).toBe(false);
	});
});

describe("extensionForAudioContentType", () => {
	test("maps common types", () => {
		expect(extensionForAudioContentType("audio/wav")).toBe("wav");
		expect(extensionForAudioContentType("audio/mpeg")).toBe("mp3");
	});
});

describe("persistGeneratedAudioToCdn", () => {
	test("uploads bytes, pins, and returns audio meta", async () => {
		const placeholder = Buffer.from("png");
		const queries = { selectServerById: { get: async () => ({ server_url: "https://blue.test/api", auth_token: "t" }) } };
		const origFetch = global.fetch;
		global.fetch = jest.fn(async (url, opts) => {
			const href = String(url);
			if (href.endsWith("/cdn/uploads") && opts?.method === "POST") {
				return {
					status: 201,
					headers: { get: () => "application/json" },
					json: async () => ({
						object_id: "o_aaaaaaaaaaaaaaaaaaaaaaaa",
						upload_url: "https://blue.test/upload",
					}),
				};
			}
			if (href === "https://blue.test/upload") {
				return { ok: true, status: 200, headers: { get: () => "" } };
			}
			if (href.includes("/pin")) {
				return {
					status: 200,
					headers: { get: () => "application/json" },
					json: async () => ({}),
				};
			}
			if (href.includes("/links")) {
				return {
					status: 201,
					headers: { get: () => "application/json" },
					json: async () => ({ url: "https://blue.test/fetch" }),
				};
			}
			return { ok: false, status: 404, headers: { get: () => "" }, json: async () => null };
		});
		try {
			const result = await persistGeneratedAudioToCdn({
				queries,
				audioBuffer: Buffer.from("audio-bytes"),
				contentType: "audio/mpeg",
				filename: "line.mp3",
				createPlaceholder: async () => placeholder,
			});
			expect(result.audio.cdn_id).toBe("o_aaaaaaaaaaaaaaaaaaaaaaaa");
			expect(result.audio.content_type).toBe("audio/mpeg");
			expect(result.usedPlaceholder).toBe(true);
			expect(Buffer.isBuffer(result.coverBuffer)).toBe(true);
		} finally {
			global.fetch = origFetch;
		}
	});
});
