import { describe, expect, it } from "@jest/globals";
import sharp from "sharp";
import {
	aspectRatioForGroupFirstSource,
	buildFitThumbnailBuffer,
	fitThumbnailStorageKey,
	shouldGenerateFitThumbnail,
	withGroupAspectRatioFromFirst,
	FIT_THUMB_LONG_EDGE,
} from "../api_routes/utils/fitThumbnail.js";
import {
	getFitThumbnailUrl,
	isCreatedMediaFitThumbnailRequest,
} from "../api_routes/utils/url.js";
import { resolveCreationDisplayMediaUrls } from "../api_routes/utils/resolveCreationDisplayMedia.js";

describe("fit thumbnail helpers", () => {
	it("skips square closest-preset media", () => {
		expect(shouldGenerateFitThumbnail(1008, 1008)).toBe(false);
		expect(shouldGenerateFitThumbnail(1024, 1024)).toBe(false);
		expect(shouldGenerateFitThumbnail(576, 1024)).toBe(true);
		expect(shouldGenerateFitThumbnail(1920, 1080)).toBe(true);
	});

	it("fitThumbnailStorageKey uses _fit.jpg beside square key in same bucket", () => {
		expect(fitThumbnailStorageKey("26_18161_1784092010983_53r10vg.png")).toBe(
			"26_18161_1784092010983_53r10vg_fit.jpg"
		);
		expect(fitThumbnailStorageKey("landscape/26_99_x.png")).toBe(
			"landscape/26_99_x_fit.jpg"
		);
	});

	it("builds a long-edge JPEG preserving aspect", async () => {
		const src = await sharp({
			create: { width: 1440, height: 2560, channels: 3, background: "#224466" },
		})
			.png()
			.toBuffer();
		const out = await buildFitThumbnailBuffer(src);
		const meta = await sharp(out).metadata();
		expect(meta.format).toBe("jpeg");
		expect(meta.height).toBe(FIT_THUMB_LONG_EDGE);
		expect(meta.width).toBe(Math.round((1440 / 2560) * FIT_THUMB_LONG_EDGE));
	});

	it("group aspect prefers MVP creative ratio on first source", () => {
		expect(
			aspectRatioForGroupFirstSource({
				width: 1008,
				height: 1008,
				meta: { args: { aspect_ratio: "1:1" } },
			})
		).toBe("1:1");
		expect(
			aspectRatioForGroupFirstSource({
				width: 576,
				height: 1024,
				meta: { args: { aspect_ratio: "9:16" } },
			})
		).toBe("9:16");
		expect(
			aspectRatioForGroupFirstSource({
				width: 1920,
				height: 1080,
				meta: { args: { aspect_ratio: "not-a-preset" } },
			})
		).toBe("16:9");
	});

	it("withGroupAspectRatioFromFirst writes args.aspect_ratio", () => {
		const next = withGroupAspectRatioFromFirst(
			{ args: { prompt: "x", aspect_ratio: "9:16" }, group: { kind: "group_creations" } },
			{ width: 1008, height: 1008, meta: { args: { aspect_ratio: "1:1" } } }
		);
		expect(next.args.aspect_ratio).toBe("1:1");
		expect(next.args.prompt).toBe("x");
		expect(next.group.kind).toBe("group_creations");
	});

	it("getFitThumbnailUrl sets variant=fit", () => {
		expect(getFitThumbnailUrl("/api/images/created/a.png")).toBe(
			"/api/images/created/a.png?variant=fit"
		);
		expect(isCreatedMediaFitThumbnailRequest("fit")).toBe(true);
		expect(isCreatedMediaFitThumbnailRequest("thumbnail")).toBe(false);
	});

	it("resolveCreationDisplayMediaUrls exposes fit_thumbnail_url", () => {
		const media = resolveCreationDisplayMediaUrls({
			row: { id: 12, file_path: "/api/images/created/u_12_x.png" },
			meta: { media_type: "image" },
		});
		expect(media.thumbnail_url).toContain("variant=thumbnail");
		expect(media.fit_thumbnail_url).toContain("variant=fit");
		expect(media.fit_thumbnail_url).toContain("creation_id=12");
	});
});
