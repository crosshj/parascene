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
	isUsableStillCoverBuffer,
	parseAudioCoverSourceRef,
	bufferForAudioCoverSource,
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
		expect(
			audioCreationNeedsCoverBackfill(
				{ file_path: "/api/images/created/grey.png" },
				{ media_type: "audio", cover_source: "embedded" }
			)
		).toBe(true);
		expect(
			audioCreationNeedsCoverBackfill(
				{ file_path: "/api/images/created/file.png" },
				{ media_type: "audio", cover_source: "embedded", import: { provider: "file" } }
			)
		).toBe(false);
		expect(inferAudioCoverSource({ import: { provider: "suno" } })).toBe("import");
		expect(inferAudioCoverSource({ import: { provider: "file" } })).toBe("embedded");
		expect(
			snapshotCoverOriginal(
				{ file_path: "/api/images/created/suno.png", filename: "suno.png" },
				{ media_type: "audio", import: { provider: "suno" } }
			)
		).toMatchObject({ cover_source: "import" });
	});

	test("rejects flat grey stills that Blue returns as ?cover=1 stubs", async () => {
		const sharp = (await import("sharp")).default;
		const grey = await sharp({
			create: { width: 128, height: 128, channels: 3, background: { r: 72, g: 72, b: 72 } },
		})
			.jpeg()
			.toBuffer();
		const art = await sharp({
			create: { width: 128, height: 128, channels: 3, background: { r: 5, g: 199, b: 111 } },
		})
			.composite([
				{
					input: await sharp({
						create: { width: 48, height: 48, channels: 3, background: { r: 124, g: 58, b: 237 } },
					})
						.png()
						.toBuffer(),
					left: 12,
					top: 20,
				},
			])
			.png()
			.toBuffer();
		expect(await isUsableStillCoverBuffer(grey)).toBe(false);
		expect(await isUsableStillCoverBuffer(art)).toBe(true);
		expect(await isUsableStillCoverBuffer(Buffer.from("nope"))).toBe(false);
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

describe("parseAudioCoverSourceRef", () => {
	test("accepts creation ids, paths, and full links", () => {
		expect(parseAudioCoverSourceRef("30718")).toEqual({ kind: "creation", creationId: 30718 });
		expect(parseAudioCoverSourceRef("/creations/30718")).toEqual({ kind: "creation", creationId: 30718 });
		expect(parseAudioCoverSourceRef("https://www.parascene.com/creations/9?x=1")).toEqual({
			kind: "creation",
			creationId: 9,
		});
	});

	test("accepts http image urls and rejects junk", () => {
		expect(parseAudioCoverSourceRef("https://cdn.example.com/cover.png")).toEqual({
			kind: "url",
			url: "https://cdn.example.com/cover.png",
		});
		expect(parseAudioCoverSourceRef("")).toBeNull();
		expect(parseAudioCoverSourceRef("not a url")).toBeNull();
		expect(parseAudioCoverSourceRef("ftp://x/a.png")).toBeNull();
	});
});

describe("bufferForAudioCoverSource", () => {
	const png = Buffer.from("cover-bytes");

	test("loads a published creation image from storage", async () => {
		const queries = {
			selectCreatedImageByIdAnyUser: {
				get: async () => ({
					id: 12,
					user_id: 8,
					published: 1,
					filename: "art.png",
					file_path: "/api/images/created/art.png",
				}),
			},
		};
		const storage = {
			getImageBuffer: jest.fn(async () => png),
		};
		const buf = await bufferForAudioCoverSource({
			queries,
			storage,
			user: { id: 3 },
			raw: "/creations/12",
		});
		expect(buf).toBe(png);
		expect(storage.getImageBuffer).toHaveBeenCalledWith("art.png");
	});

	test("hides unpublished creations from other users", async () => {
		const queries = {
			selectCreatedImageByIdAnyUser: {
				get: async () => ({
					id: 12,
					user_id: 8,
					published: 0,
					filename: "art.png",
					file_path: "/api/images/created/art.png",
				}),
			},
		};
		await expect(
			bufferForAudioCoverSource({
				queries,
				storage: { getImageBuffer: async () => png },
				user: { id: 3 },
				raw: "12",
			})
		).rejects.toMatchObject({ status: 404, message: "Creation not found" });
	});

	test("rejects placeholder audio covers", async () => {
		const queries = {
			selectCreatedImageByIdAnyUser: {
				get: async () => ({
					id: 12,
					user_id: 3,
					published: 0,
					filename: "wave.svg",
					file_path: "/images/audio-cover-waveform.svg",
				}),
			},
		};
		await expect(
			bufferForAudioCoverSource({
				queries,
				storage: { getImageBuffer: async () => png },
				user: { id: 3 },
				raw: "12",
			})
		).rejects.toMatchObject({ status: 400 });
	});

	test("fetches a remote image url", async () => {
		const fetchBuffer = jest.fn(async () => png);
		const buf = await bufferForAudioCoverSource({
			queries: {},
			storage: {},
			user: { id: 3 },
			raw: "https://cdn.example.com/art.png",
			fetchBuffer,
		});
		expect(buf).toBe(png);
		expect(fetchBuffer).toHaveBeenCalledWith("https://cdn.example.com/art.png");
	});
});
