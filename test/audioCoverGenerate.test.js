import { describe, expect, test, jest } from "@jest/globals";
import {
	albumCoverPromptFromCreation,
	resolveAudioCoverGenerateTarget,
	runAudioCoverJob,
} from "../api_routes/utils/audioCoverGenerate.js";
import {
	applyAudioCoverBuffer,
	audioCreationNeedsCoverBackfill,
	canResetAudioCover,
	inferAudioCoverSource,
	isAudioCreationRow,
	snapshotCoverOriginal,
} from "../api_routes/utils/audioCoverApply.js";

describe("audioCoverGenerate helpers", () => {
	test("prefers Blue text2image then Replicate", () => {
		const prompt = "glowing harbor";
		expect(
			resolveAudioCoverGenerateTarget(
				[
					{
						id: 6,
						status: "active",
						server_config: { methods: { text2image: { credits: 0.1, async: true, fields: { model: { options: [{ value: "diffusion_models/z-image/z_image_turbo_bf16.safetensors" }] } } } } },
					},
				],
				prompt
			)
		).toMatchObject({
			server_id: 6,
			method: "text2image",
			credits: 0.1,
			async: true,
		});
		expect(
			resolveAudioCoverGenerateTarget(
				[
					{
						id: 1,
						status: "active",
						server_config: { methods: { replicate: { credits: 3 } } },
					},
				],
				prompt
			)
		).toMatchObject({
			server_id: 1,
			method: "replicate",
			credits: 3,
			args: { model: "prunaai/p-image", prompt },
		});
		expect(resolveAudioCoverGenerateTarget([], prompt)).toBeNull();
	});

	test("prompt uses title then args", () => {
		expect(albumCoverPromptFromCreation({ title: "Harbor" }, {}, "")).toContain("Harbor");
		expect(albumCoverPromptFromCreation({}, { args: { prompt: "soft rain" } }, "")).toContain("soft rain");
		expect(albumCoverPromptFromCreation({}, {}, "custom art")).toBe("custom art");
	});

	test("audio row detection", () => {
		expect(isAudioCreationRow({}, { media_type: "audio" })).toBe(true);
		expect(isAudioCreationRow({}, { audio: { cdn_id: "o_1" } })).toBe(true);
		expect(isAudioCreationRow({}, { media_type: "image" })).toBe(false);
	});

	test("original snapshot and backfill detection", () => {
		const image = { file_path: "/api/images/created/a.png", filename: "a.png", width: 1024, height: 1024 };
		expect(snapshotCoverOriginal(image, { cover_source: "procedural" })).toMatchObject({
			file_path: "/api/images/created/a.png",
			cover_source: "procedural",
		});
		expect(snapshotCoverOriginal(image, { cover_placeholder: true })).toBeNull();
		expect(canResetAudioCover({ cover_source: "upload" })).toBe(true);
		expect(canResetAudioCover({ cover_source: "procedural" })).toBe(false);
		expect(canResetAudioCover({ cover_original: { file_path: "/x.png" } })).toBe(true);
		expect(audioCreationNeedsCoverBackfill({ file_path: "/x.png" }, { media_type: "audio", cover_placeholder: true })).toBe(true);
		expect(
			audioCreationNeedsCoverBackfill(
				{ file_path: "/api/images/created/a.png" },
				{ media_type: "audio", cover_source: "procedural" }
			)
		).toBe(false);
		expect(
			audioCreationNeedsCoverBackfill(
				{ file_path: "/api/images/created/suno.png" },
				{ media_type: "audio", import: { provider: "suno" } }
			)
		).toBe(false);
		expect(
			audioCreationNeedsCoverBackfill(
				{ file_path: "/images/audio-cover-waveform.svg" },
				{ media_type: "audio", import: { provider: "suno" } }
			)
		).toBe(true);
		expect(inferAudioCoverSource({ import: { provider: "suno" } })).toBe("import");
		expect(inferAudioCoverSource({ import: { provider: "file" } })).toBe("embedded");
		expect(
			snapshotCoverOriginal(
				{ file_path: "/api/images/created/suno.png", filename: "suno.png" },
				{ media_type: "audio", import: { provider: "suno" } }
			)
		).toMatchObject({ cover_source: "import" });
	});
});

describe("applyAudioCoverBuffer", () => {
	test("uploads a square png and clears placeholder", async () => {
		const png = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
			"base64"
		);
		const queries = {
			updateCreatedImageJobCompleted: {
				run: jest.fn(async () => ({ changes: 1 })),
			},
		};
		const storage = {
			uploadImage: jest.fn(async (_buf, filename) => `/api/images/created/${filename}`),
		};
		const result = await applyAudioCoverBuffer({
			queries,
			storage,
			image: {
				id: 9,
				user_id: 3,
				color: null,
				meta: { media_type: "audio", cover_placeholder: true },
			},
			buffer: png,
			coverSource: "upload",
		});
		expect(result.cover_source || result.meta.cover_source).toBe("upload");
		expect(result.meta.cover_placeholder).toBeUndefined();
		expect(result.width).toBe(1024);
		expect(storage.uploadImage).toHaveBeenCalled();
	});

	test("first replace snapshots the original still", async () => {
		const png = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
			"base64"
		);
		const queries = {
			updateCreatedImageJobCompleted: {
				run: jest.fn(async () => ({ changes: 1 })),
			},
		};
		const storage = {
			uploadImage: jest.fn(async (_buf, filename) => `/api/images/created/${filename}`),
		};
		const result = await applyAudioCoverBuffer({
			queries,
			storage,
			image: {
				id: 9,
				user_id: 3,
				filename: "orig.png",
				file_path: "/api/images/created/orig.png",
				width: 1024,
				height: 1024,
				meta: { media_type: "audio", cover_source: "procedural" },
			},
			buffer: png,
			coverSource: "upload",
		});
		expect(result.meta.cover_original).toMatchObject({
			file_path: "/api/images/created/orig.png",
			filename: "orig.png",
			cover_source: "procedural",
		});
	});
});

describe("runAudioCoverJob", () => {
	test("applies provider png and refunds on failure", async () => {
		const png = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
			"base64"
		);
		const image = {
			id: 4,
			user_id: 2,
			meta: { media_type: "audio", cover_generate: { status: "loading" } },
		};
		const queries = {
			selectCreatedImageById: { get: async () => image },
			selectServerById: {
				get: async () => ({ id: 1, status: "active", server_url: "https://prov.test", auth_token: "t" }),
			},
			updateCreatedImageJobCompleted: { run: async () => ({ changes: 1 }) },
			updateCreatedImageMeta: { run: jest.fn(async () => ({ changes: 1 })) },
			updateUserCreditsBalance: { run: jest.fn(async () => ({ changes: 1 })) },
		};
		const storage = { uploadImage: async () => "/api/images/created/x.png" };
		const origFetch = global.fetch;
		global.fetch = jest.fn(async () => ({
			ok: true,
			headers: { get: () => "image/png" },
			arrayBuffer: async () => png,
		}));
		try {
			const ok = await runAudioCoverJob({
				queries,
				storage,
				payload: {
					created_image_id: 4,
					user_id: 2,
					server_id: 1,
					method: "replicate",
					args: { prompt: "x", model: "prunaai/p-image" },
					credit_cost: 3,
				},
			});
			expect(ok.ok).toBe(true);
		} finally {
			global.fetch = origFetch;
		}

		global.fetch = jest.fn(async () => ({
			ok: false,
			status: 502,
			headers: { get: () => "application/json" },
			text: async () => "nope",
		}));
		try {
			const failed = await runAudioCoverJob({
				queries,
				storage,
				payload: {
					created_image_id: 4,
					user_id: 2,
					server_id: 1,
					method: "replicate",
					args: { prompt: "x" },
					credit_cost: 3,
				},
			});
			expect(failed.ok).toBe(false);
			expect(queries.updateUserCreditsBalance.run).toHaveBeenCalled();
		} finally {
			global.fetch = origFetch;
		}
	});
});
