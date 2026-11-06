import { describe, expect, test } from "@jest/globals";
import {
	materializeBlueProviderAudioArgs,
	resolveAudioCreationProviderArgs,
	shareUrlForCdnCreationAudio
} from "../api_routes/utils/audioClips.js";

const CDN_ID = "o_8972e00517b91de76c0d3c64";

describe("shareUrlForCdnCreationAudio", () => {
	test("includes so and du on the share path", () => {
		const url = shareUrlForCdnCreationAudio(27140, 26, { so: 8, du: 9 }, "https://sh.example");
		expect(url).toMatch(/^https:\/\/sh\.example\/api\/share\/v1\/[^/]+\/cdn-audio\?/);
		const u = new URL(url);
		expect(u.searchParams.get("so")).toBe("8");
		expect(u.searchParams.get("du")).toBe("9");
	});
});

describe("resolveAudioCreationProviderArgs", () => {
	function queriesWith(row) {
		return {
			selectCreatedImageByIdAnyUser: {
				get: async () => row
			}
		};
	}

	test("no-ops when audio_creation_id is absent", async () => {
		const out = await resolveAudioCreationProviderArgs({}, 26, { prompt: "x" });
		expect(out).toEqual({ ok: true, args: { prompt: "x" }, handled: false });
	});

	test("maps creation + window onto input_audio_urls and drops audio_clip_id", async () => {
		const queries = queriesWith({
			id: 27140,
			status: "completed",
			unavailable_at: null,
			meta: {
				audio: {
					cdn_id: CDN_ID,
					duration: 314.24,
					content_type: "audio/mpeg"
				}
			}
		});
		const out = await resolveAudioCreationProviderArgs(
			queries,
			26,
			{
				prompt: "x",
				audio_creation_id: 27140,
				audio_start_sec: 8,
				audio_duration_sec: 9,
				audio_clip_id: 999
			},
			"https://sh.example"
		);
		expect(out.ok).toBe(true);
		expect(out.handled).toBe(true);
		expect(out.args.audio_clip_id).toBeUndefined();
		expect(out.args.audio_creation_id).toBe(27140);
		expect(out.args.audio_start_sec).toBe(8);
		expect(out.args.audio_duration_sec).toBe(9);
		expect(Array.isArray(out.args.input_audio_urls)).toBe(true);
		expect(out.args.input_audio_urls[0]).toMatch(/\/cdn-audio\?/);
		expect(out.args.input_audio_urls[0]).toContain("so=8");
		expect(out.args.input_audio_urls[0]).toContain("du=9");
		expect(out.args.audio_url).toBe(out.args.input_audio_urls[0]);
	});

	test("rejects creations without CDN audio", async () => {
		const queries = queriesWith({
			id: 1,
			status: "completed",
			meta: {}
		});
		const out = await resolveAudioCreationProviderArgs(queries, 26, {
			audio_creation_id: 1,
			audio_duration_sec: 3
		});
		expect(out.ok).toBe(false);
		expect(out.status).toBe(400);
		expect(out.code).toBe("audio_resolve_failed");
		expect(out.error).toMatch(/no CDN audio/i);
	});

	test("requires a positive duration", async () => {
		const queries = queriesWith({
			id: 27140,
			status: "completed",
			meta: { audio: { cdn_id: CDN_ID } }
		});
		const out = await resolveAudioCreationProviderArgs(queries, 26, {
			audio_creation_id: 27140,
			audio_start_sec: 0
		});
		expect(out.ok).toBe(false);
		expect(out.status).toBe(400);
		expect(out.code).toBe("audio_resolve_failed");
	});
});

describe("materializeBlueProviderAudioArgs", () => {
	const row = {
		id: 27140,
		status: "completed",
		unavailable_at: null,
		meta: { audio: { cdn_id: CDN_ID } }
	};

	test("mints a Blue CDN URL and strips Parascene creation refs", async () => {
		const queries = {
			selectCreatedImageByIdAnyUser: { get: async () => row }
		};
		const out = await materializeBlueProviderAudioArgs(queries, 26, {
			prompt: "x",
			audio_creation_id: 27140,
			audio_start_sec: 8,
			audio_duration_sec: 9
		}, {
			methodFields: { input_audio_urls: { type: "audio_url_array" } },
			loadBlueCdnContext: async () => ({ origin: "https://blue.example" }),
			mintCdnFetchLink: async () => ({ url: "https://blue.example/cdn/window" })
		});
		expect(out.ok).toBe(true);
		expect(out.handled).toBe(true);
		expect(out.args.input_audio_urls).toEqual(["https://blue.example/cdn/window"]);
		expect(out.args.audio_creation_id).toBeUndefined();
		expect(out.args.audio_start_sec).toBeUndefined();
		expect(out.args.audio_duration_sec).toBeUndefined();
		expect(out.args.audio_url).toBeUndefined();
		expect(out.args.prompt).toBe("x");
	});

	test("returns a client-facing error when mint fails", async () => {
		const queries = {
			selectCreatedImageByIdAnyUser: { get: async () => row }
		};
		const err = new Error("Could not reach audio host");
		err.status = 502;
		const out = await materializeBlueProviderAudioArgs(queries, 26, {
			audio_creation_id: 27140,
			audio_duration_sec: 9
		}, {
			loadBlueCdnContext: async () => ({ origin: "https://blue.example" }),
			mintCdnFetchLink: async () => {
				throw err;
			}
		});
		expect(out.ok).toBe(false);
		expect(out.status).toBe(502);
		expect(out.code).toBe("audio_resolve_failed");
		expect(out.error).toBe("Could not reach audio host");
	});
});
