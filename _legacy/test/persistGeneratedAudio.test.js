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

	test("uses createFallbackCover when there is no embedded art", async () => {
		const sharp = (await import("sharp")).default;
		const fallback = await sharp({
			create: { width: 64, height: 64, channels: 3, background: { r: 5, g: 199, b: 111 } },
		})
			.composite([
				{
					input: await sharp({
						create: { width: 20, height: 20, channels: 3, background: { r: 244, g: 63, b: 94 } },
					})
						.png()
						.toBuffer(),
					left: 8,
					top: 10,
				},
			])
			.png()
			.toBuffer();
		const queries = { selectServerById: { get: async () => ({ server_url: "https://blue.test/api", auth_token: "t" }) } };
		const origFetch = global.fetch;
		global.fetch = jest.fn(async (url, opts) => {
			const href = String(url);
			if (href.endsWith("/cdn/uploads") && opts?.method === "POST") {
				return {
					status: 201,
					headers: { get: () => "application/json" },
					json: async () => ({ object_id: "o_aaaaaaaaaaaaaaaaaaaaaaaa", upload_url: "https://blue.test/upload" }),
				};
			}
			if (href === "https://blue.test/upload") return { ok: true, status: 200, headers: { get: () => "" } };
			if (href.includes("/pin")) {
				return { status: 200, headers: { get: () => "application/json" }, json: async () => ({}) };
			}
			if (href.includes("/links")) {
				return { status: 201, headers: { get: () => "application/json" }, json: async () => ({ url: "https://blue.test/fetch" }) };
			}
			return { ok: false, status: 404, headers: { get: () => "" }, json: async () => null };
		});
		try {
			const result = await persistGeneratedAudioToCdn({
				queries,
				audioBuffer: Buffer.from("audio-bytes"),
				contentType: "audio/mpeg",
				filename: "line.mp3",
				createPlaceholder: async () => Buffer.from("png"),
				createFallbackCover: async () => fallback,
			});
			expect(result.usedPlaceholder).toBe(false);
			expect(result.coverSource).toBe("procedural");
		} finally {
			global.fetch = origFetch;
		}
	});

	test("ignores a flat Blue ?cover=1 jpeg and uses the procedural fallback", async () => {
		const sharp = (await import("sharp")).default;
		const grey = await sharp({
			create: { width: 256, height: 256, channels: 3, background: { r: 64, g: 64, b: 64 } },
		})
			.jpeg()
			.toBuffer();
		const fallback = await sharp({
			create: { width: 64, height: 64, channels: 3, background: { r: 5, g: 199, b: 111 } },
		})
			.composite([
				{
					input: await sharp({
						create: { width: 20, height: 20, channels: 3, background: { r: 244, g: 63, b: 94 } },
					})
						.png()
						.toBuffer(),
					left: 8,
					top: 10,
				},
			])
			.png()
			.toBuffer();
		const queries = { selectServerById: { get: async () => ({ server_url: "https://blue.test/api", auth_token: "t" }) } };
		const origFetch = global.fetch;
		global.fetch = jest.fn(async (url, opts) => {
			const href = String(url);
			if (href.endsWith("/cdn/uploads") && opts?.method === "POST") {
				return {
					status: 201,
					headers: { get: () => "application/json" },
					json: async () => ({ object_id: "o_aaaaaaaaaaaaaaaaaaaaaaaa", upload_url: "https://blue.test/upload" }),
				};
			}
			if (href === "https://blue.test/upload") return { ok: true, status: 200, headers: { get: () => "" } };
			if (href.includes("/pin")) {
				return { status: 200, headers: { get: () => "application/json" }, json: async () => ({}) };
			}
			if (href.includes("/links")) {
				return { status: 201, headers: { get: () => "application/json" }, json: async () => ({ url: "https://blue.test/fetch" }) };
			}
			if (href.includes("cover=1")) {
				return {
					ok: true,
					status: 200,
					headers: { get: (n) => (String(n).toLowerCase() === "content-type" ? "image/jpeg" : "") },
					arrayBuffer: async () => grey.buffer.slice(grey.byteOffset, grey.byteOffset + grey.byteLength),
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
				createPlaceholder: async () => Buffer.from("png"),
				createFallbackCover: async () => fallback,
			});
			expect(result.usedPlaceholder).toBe(false);
			expect(result.coverSource).toBe("procedural");
		} finally {
			global.fetch = origFetch;
		}
	});
});
