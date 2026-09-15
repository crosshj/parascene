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
});
