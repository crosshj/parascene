import { describe, expect, test } from "@jest/globals";
import {
	AUDIO_COVER_SIZE,
	buildProceduralAudioCoverBuffer,
	buildProceduralAudioCoverSvg,
	monogramFromTitle,
	pickAudioCoverLayout,
	pickBloomColorCount,
	pickBloomGravity,
	minBloomContrast,
	MIN_BLOOM_DELTA_E,
	pickBloomPalette,
	pickGlassFacet,
	pickGlassTint,
	AUDIO_COVER_ACCENTS,
	GLASS_SHAPES,
	DETAIL_KINDS,
	pickCoverDetail,
	createAudioCoverRng,
	resolveAudioCoverKind,
} from "../api_routes/utils/audioCoverProcedural.js";

describe("audioCoverProcedural", () => {
	test("same seed and layout stay stable", () => {
		const a = buildProceduralAudioCoverSvg({ seed: "1:2:north", layout: "bloom", title: "North" });
		const b = buildProceduralAudioCoverSvg({ seed: "1:2:north", layout: "bloom", title: "North" });
		expect(a.svg).toBe(b.svg);
		expect(a.layout).toBe("bloom");
	});

	test("different seeds produce different svg", () => {
		const svgs = ["aurora", "ember", "harbor", "signal", "glass", "kite"].map(
			(seed) => buildProceduralAudioCoverSvg({ seed, layout: "bloom" }).svg
		);
		expect(new Set(svgs).size).toBeGreaterThan(1);
	});

	test("kind and monogram helpers", () => {
		expect(resolveAudioCoverKind("replicateSpeech")).toBe("speech");
		expect(resolveAudioCoverKind("replicateMusic")).toBe("music");
		expect(monogramFromTitle("North Star")).toBe("N");
		expect(pickAudioCoverLayout("seed", "speech")).toBe("bloom");
	});

	test("bloom palettes keep contrast between chosen colors", () => {
		for (let i = 0; i < 80; i += 1) {
			const { colors } = pickBloomPalette(createAudioCoverRng(`contrast-${i}`));
			if (colors.length === 2) {
				expect(minBloomContrast(colors)).toBeGreaterThanOrEqual(MIN_BLOOM_DELTA_E);
			}
		}
	});

	test("color count is seeded and 2–5 are equally available", () => {
		const counts = new Set();
		for (let i = 0; i < 90; i += 1) {
			counts.add(pickBloomColorCount(createAudioCoverRng(`palette-${i}`)));
		}
		expect(counts.has(1)).toBe(false);
		expect(counts.has(2)).toBe(true);
		expect(counts.has(3)).toBe(true);
		expect(counts.has(4)).toBe(true);
		expect(counts.has(5)).toBe(true);
		expect([...counts].every((n) => n >= 2 && n <= 5)).toBe(true);
	});

	test("glass facet is seeded with loose placement", () => {
		const a = pickGlassFacet(createAudioCoverRng("glass-a"), AUDIO_COVER_SIZE);
		const b = pickGlassFacet(createAudioCoverRng("glass-a"), AUDIO_COVER_SIZE);
		const c = pickGlassFacet(createAudioCoverRng("glass-b"), AUDIO_COVER_SIZE);
		expect(a).toEqual(b);
		expect(a).not.toEqual(c);
		expect(GLASS_SHAPES).toContain(a.shape);
		expect(a.radius).toBeGreaterThan(AUDIO_COVER_SIZE * 0.54);
		expect(a.radius).toBeLessThan(AUDIO_COVER_SIZE * 0.85);
		expect(a.magnify).toBeGreaterThan(1);
	});

	test("glass shape is always large", () => {
		for (let i = 0; i < 40; i += 1) {
			const facet = pickGlassFacet(createAudioCoverRng(`scale-${i}`), AUDIO_COVER_SIZE);
			expect(facet.radius).toBeGreaterThan(AUDIO_COVER_SIZE * 0.54);
		}
	});

	test("bloom gravity cluster and fill are available", () => {
		const modes = new Set();
		for (let i = 0; i < 80; i += 1) {
			modes.add(pickBloomGravity(createAudioCoverRng(`grav-${i}`)).mode);
		}
		expect(modes.has("cluster")).toBe(true);
		expect(modes.has("fill")).toBe(true);
	});

	test("glass facets often sit off-center and clip the frame", () => {
		const mid = AUDIO_COVER_SIZE / 2;
		let offCenter = 0;
		let clips = 0;
		for (let i = 0; i < 80; i += 1) {
			const facet = pickGlassFacet(createAudioCoverRng(`place-${i}`), AUDIO_COVER_SIZE);
			if (Math.hypot(facet.cx - mid, facet.cy - mid) > AUDIO_COVER_SIZE * 0.08) offCenter += 1;
			const overflow =
				facet.cx - facet.radius < 0
				|| facet.cx + facet.radius > AUDIO_COVER_SIZE
				|| facet.cy - facet.radius < 0
				|| facet.cy + facet.radius > AUDIO_COVER_SIZE;
			if (overflow) clips += 1;
		}
		expect(offCenter).toBeGreaterThan(40);
		expect(clips).toBe(80);
	});

	test("glass tint is a leftover palette color", () => {
		const bloom = [AUDIO_COVER_ACCENTS[0], AUDIO_COVER_ACCENTS[1]];
		const tints = new Set();
		for (let i = 0; i < 40; i += 1) {
			const tint = pickGlassTint(createAudioCoverRng(`tint-${i}`), bloom);
			expect(AUDIO_COVER_ACCENTS).toContain(tint);
			expect(bloom).not.toContain(tint);
			tints.add(tint);
		}
		expect(tints.size).toBeGreaterThan(1);
	});

	test("cover details are optional and drawn from the assortment", () => {
		const kinds = new Set();
		let empty = 0;
		for (let i = 0; i < 160; i += 1) {
			const kind = pickCoverDetail(createAudioCoverRng(`detail-${i}`));
			if (kind == null) empty += 1;
			else kinds.add(kind);
		}
		expect(empty).toBeGreaterThan(40);
		expect(empty).toBeLessThan(120);
		expect([...DETAIL_KINDS].every((kind) => kinds.has(kind))).toBe(true);
	});

	test("glass shapes are all equally available", () => {
		const shapes = new Set();
		for (let i = 0; i < 120; i += 1) {
			shapes.add(pickGlassFacet(createAudioCoverRng(`facet-${i}`), AUDIO_COVER_SIZE).shape);
		}
		expect([...GLASS_SHAPES].every((shape) => shapes.has(shape))).toBe(true);
		expect([...shapes].every((shape) => GLASS_SHAPES.includes(shape))).toBe(true);
	});

	test("buffer is a 1024 png", async () => {
		const { buffer, width, height, layout } = await buildProceduralAudioCoverBuffer({
			seed: "test",
			layout: "bloom",
			kind: "music",
		});
		expect(Buffer.isBuffer(buffer)).toBe(true);
		expect(buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
		expect(width).toBe(AUDIO_COVER_SIZE);
		expect(height).toBe(AUDIO_COVER_SIZE);
		expect(layout).toBe("bloom");
	}, 15000);
});
