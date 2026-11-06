import { describe, expect, test } from "@jest/globals";
import sharp from "sharp";
import {
	CHALLENGE_HERO_PREVIEW_HEIGHT,
	CHALLENGE_HERO_PREVIEW_WIDTH,
	challengeHeroPreviewStorageKey,
	processChallengeHeroPreviewBuffer
} from "../api_routes/utils/challengeHeroPreview.js";

describe("challenge hero preview", () => {
	test("storage key is stable per creation", () => {
		expect(challengeHeroPreviewStorageKey(20572)).toBe("challenge-heroes/20572.webp");
	});

	test("encodes a 16:9 webp cover", async () => {
		const src = await sharp({
			create: { width: 1024, height: 1024, channels: 3, background: "#3366ff" }
		})
			.png()
			.toBuffer();
		const out = await processChallengeHeroPreviewBuffer(src);
		const meta = await sharp(out).metadata();
		expect(meta.format).toBe("webp");
		expect(meta.width).toBe(CHALLENGE_HERO_PREVIEW_WIDTH);
		expect(meta.height).toBe(CHALLENGE_HERO_PREVIEW_HEIGHT);
		expect(out.length).toBeLessThan(src.length);
	});
});
