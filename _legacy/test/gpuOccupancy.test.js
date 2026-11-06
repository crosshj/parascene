import { describe, expect, test } from "@jest/globals";
import {
	ALWAYS_NEXT_MAX,
	applyGpuBid,
	boostFromNamedPrice,
	formatCreditsBoost,
	namedPriceFromBoost,
	occupancyDialogModel,
	occupancyIsBusy,
	parseGpuOccupancy,
	placeAtProposedMax,
	productBoostRange,
	resolveProductNamedPrice,
} from "../public/shared/gpuOccupancy.js";

describe("gpu occupancy", () => {
	test("ignores cost-only query payloads", () => {
		expect(parseGpuOccupancy({ supported: true, cost: 10 })).toBeNull();
		expect(occupancyIsBusy(null)).toBe(false);
	});

	test("parses pending maxes without prompts", () => {
		const occupancy = parseGpuOccupancy({
			idle: false,
			running: { kind: "video", family: "wan", prompt: "secret" },
			running_eta_s: 90,
			ahead: 2,
			eta_s: 720,
			cost: 1,
			supported: true,
			pending: [
				{ max: 12, eta_s: 400, kind: "video", prompt: "secret dog" },
				{ max: 1, eta_s: 230, kind: "still" }
			],
			highest_max: 12
		});
		expect(occupancy.running).toEqual({ kind: "video", family: "wan" });
		expect(occupancy.pending).toEqual([
			{ max: 12, eta_s: 400, kind: "video" },
			{ max: 1, eta_s: 230, kind: "still" }
		]);
		expect(JSON.stringify(occupancy)).not.toMatch(/secret/);
	});

	test("product copy does not say Blue", () => {
		const occupancy = parseGpuOccupancy({
			idle: false,
			running: { kind: "video", family: "wan" },
			ahead: 1,
			eta_s: 600,
			cost: 1,
			supported: true
		});
		const model = occupancyDialogModel(occupancy, { lane: "product" });
		expect(model.title).toBe("This server is busy");
		expect(model.title + model.message).not.toMatch(/Blue/i);
		expect(model.stats.some((s) => s.label === "Credits")).toBe(true);
		expect(model.confirmLabel).toBe("Generate");
	});

	test("stat rows do not repeat the headline (no Ahead/Wait duplicates)", () => {
		const occupancy = parseGpuOccupancy({
			idle: false,
			running: { kind: "video", family: "minimax_r2v" },
			ahead: 5,
			eta_s: 2040,
			cost: 0.1,
			supported: true
		});
		const model = occupancyDialogModel(occupancy, { lane: "product" });
		expect(model.message).toMatch(/6th in line/);
		expect(model.message).toMatch(/About 34 min/);
		const labels = model.stats.map((s) => s.label);
		expect(labels).toEqual(["Now running", "Credits"]);
		expect(model.stats[0].value).toBe("Video · minimax r2v");
	});

	test("places a proposed max on the pending snapshot", () => {
		const occupancy = parseGpuOccupancy({
			idle: false,
			running: { kind: "still", family: "flux" },
			running_eta_s: 40,
			ahead: 3,
			eta_s: 670,
			cost: 1,
			pending: [
				{ max: 12, eta_s: 400, kind: "video" },
				{ max: 1, eta_s: 120, kind: "still" },
				{ max: 1, eta_s: 110, kind: "still" }
			],
			highest_max: 12
		});
		expect(placeAtProposedMax(occupancy, 1).place).toBe(4);
		expect(placeAtProposedMax(occupancy, 12).place).toBe(2);
		expect(placeAtProposedMax(occupancy, 50).place).toBe(1);
	});

	test("credits boost is added to list in 0.5 steps", () => {
		expect(productBoostRange(0.1)).toEqual({ min: 0, max: 49.5, step: 0.5 });
		expect(namedPriceFromBoost(0.1, 0)).toBe(0.1);
		expect(namedPriceFromBoost(0.1, 0.5)).toBe(0.6);
		expect(boostFromNamedPrice(0.1, 0.6)).toBe(0.5);
		expect(formatCreditsBoost(0.5)).toBe("+0.5");
	});

	test("rejects under list and clamps above the cap", () => {
		expect(resolveProductNamedPrice(0.5, 0.1)).toEqual({
			ok: true,
			cost: 0.6,
			max_bid: 0.5
		});
		expect(resolveProductNamedPrice(80, 1)).toEqual({
			ok: true,
			cost: 50,
			max_bid: 49
		});
	});

	test("direct always-next does not send a credit bid", () => {
		expect(
			applyGpuBid({ prompt: "x" }, { maxBid: ALWAYS_NEXT_MAX, alwaysNext: true }, "direct")
		).toEqual({ prompt: "x", always_next: true });
	});

	test("slider copy uses the pending snapshot, not list ahead", () => {
		const occupancy = parseGpuOccupancy({
			idle: false,
			running: { kind: "video", family: "wan" },
			running_eta_s: 60,
			ahead: 2,
			eta_s: 360,
			cost: 1,
			pending: [
				{ max: 50, eta_s: 200, kind: "video" },
				{ max: 1, eta_s: 100, kind: "still" }
			],
			highest_max: 50
		});
		const atList = occupancyDialogModel(occupancy, { lane: "product", proposedMax: 0 });
		const atCap = occupancyDialogModel(occupancy, { lane: "product", proposedMax: 50 });
		expect(atList.message).toMatch(/3rd in line/);
		expect(atCap.message).toMatch(/2nd in line/);
		expect(atCap.capNote).toMatch(/boosted/i);
	});
});
