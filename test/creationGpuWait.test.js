import { describe, expect, test } from "@jest/globals";
import {
	creationFinishTimeoutMs,
	gpuWaitFromProviderStatus,
	gpuWaitMetaPatch,
	isCreationFinishTimedOut,
	isCreationGpuInFlight,
} from "../api_routes/utils/creationGpuWait.js";
import {
	creationGpuWaitLabel,
	isCreationGenerating,
	isCreationInLine,
} from "../public/shared/creationGpuWait.js";

describe("gpuWaitFromProviderStatus", () => {
	test("maps Blue pending to queued / in line", () => {
		expect(gpuWaitFromProviderStatus("pending")).toEqual({
			phase: "in_line",
			creationStatus: "queued",
		});
		expect(gpuWaitFromProviderStatus("")).toEqual({
			phase: "in_line",
			creationStatus: "queued",
		});
	});

	test("maps Blue running to processing / generating", () => {
		expect(gpuWaitFromProviderStatus("running")).toEqual({
			phase: "generating",
			creationStatus: "processing",
		});
		expect(gpuWaitFromProviderStatus("processing")).toEqual({
			phase: "generating",
			creationStatus: "processing",
		});
	});

	test("ignores terminal provider status", () => {
		expect(gpuWaitFromProviderStatus("succeeded")).toBeNull();
		expect(gpuWaitFromProviderStatus("failed")).toBeNull();
	});
});

describe("creation finish clock", () => {
	test("does not expire queued", () => {
		expect(
			isCreationFinishTimedOut("queued", {
				timeout_at: "2000-01-01T00:00:00.000Z",
			}),
		).toBe(false);
	});

	test("expires processing after timeout_at", () => {
		expect(
			isCreationFinishTimedOut(
				"processing",
				{ timeout_at: "2000-01-01T00:00:00.000Z" },
				Date.parse("2000-01-01T00:01:00.000Z"),
			),
		).toBe(true);
	});

	test("sets running_at and timeout_at on first generating", () => {
		const { mapped, patch } = gpuWaitMetaPatch({}, "running", "image2video");
		expect(mapped.creationStatus).toBe("processing");
		expect(patch.running_at).toBeTruthy();
		expect(Date.parse(patch.timeout_at) - Date.parse(patch.running_at)).toBe(
			creationFinishTimeoutMs("image2video"),
		);
	});

	test("does not reset timeout when already running", () => {
		const existing = { running_at: "2026-01-01T00:00:00.000Z" };
		const { patch } = gpuWaitMetaPatch(existing, "running", "text2image");
		expect(patch.running_at).toBeUndefined();
		expect(patch.timeout_at).toBeUndefined();
	});
});

describe("labels", () => {
	test("in line vs generating", () => {
		expect(isCreationInLine("queued")).toBe(true);
		expect(isCreationGenerating("processing")).toBe(true);
		expect(creationGpuWaitLabel("queued", 3)).toBe("In line · 3");
		expect(creationGpuWaitLabel("processing")).toBe("Generating…");
		expect(isCreationGpuInFlight("queued")).toBe(true);
	});
});
