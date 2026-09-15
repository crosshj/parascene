import { describe, expect, test } from "@jest/globals";
import {
	occupancyDialogModel,
	occupancyIsBusy,
	parseGpuOccupancy,
} from "../public/shared/gpuOccupancy.js";

describe("gpu occupancy", () => {
	test("ignores cost-only query payloads", () => {
		expect(parseGpuOccupancy({ supported: true, cost: 10 })).toBeNull();
		expect(occupancyIsBusy(null)).toBe(false);
	});

	test("product copy does not say Blue", () => {
		const occupancy = parseGpuOccupancy({
			idle: false,
			running: { kind: "video", family: "wan" },
			ahead: 1,
			eta_s: 600,
			cost: 1,
			supported: true,
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
			supported: true,
		});
		const model = occupancyDialogModel(occupancy, { lane: "product" });
		expect(model.message).toMatch(/6th in line/);
		expect(model.message).toMatch(/About 34 min/);
		const labels = model.stats.map((s) => s.label);
		expect(labels).toEqual(["Now running", "Credits"]);
		expect(model.stats[0].value).toBe("Video · minimax r2v");
	});
});
