import { describe, expect, test } from "@jest/globals";
import {
	creationFinishTimeoutMs,
	gpuWaitFromProviderStatus,
	gpuWaitMetaPatch,
	isCreationFinishTimedOut,
	isCreationGpuInFlight,
	isTerminalCompletedProviderStatus,
	shouldKeepProviderPoll,
} from "../api_routes/utils/creationGpuWait.js";
import {
	creationGpuWaitDetail,
	creationGpuWaitLabel,
	creationGpuWaitMarkup,
	isCreationGenerating,
	isCreationInLine,
} from "../public/shared/creationGpuWait.js";
import { findCreationsPollStatusUpdates } from "../public/shared/creationsInFlightPoller.js";

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

describe("provider poll continuation", () => {
	test("treats succeeded JSON as terminal completed, not in-flight", () => {
		expect(isTerminalCompletedProviderStatus("succeeded")).toBe(true);
		expect(isTerminalCompletedProviderStatus("running")).toBe(false);
	});

	test("keeps polling queued with no finish clock", () => {
		expect(
			shouldKeepProviderPoll("queued", {
				timeout_at: "2000-01-01T00:00:00.000Z",
			}),
		).toBe(true);
	});

	test("keeps polling generating until timeout_at", () => {
		expect(
			shouldKeepProviderPoll(
				"processing",
				{ timeout_at: "2026-01-01T00:20:00.000Z" },
				Date.parse("2026-01-01T00:10:00.000Z"),
			),
		).toBe(true);
	});

	test("stops polling generating after timeout_at", () => {
		expect(
			shouldKeepProviderPoll(
				"processing",
				{ timeout_at: "2026-01-01T00:10:00.000Z" },
				Date.parse("2026-01-01T00:11:00.000Z"),
			),
		).toBe(false);
	});
});

describe("labels", () => {
	test("queued vs generating", () => {
		expect(isCreationInLine("queued")).toBe(true);
		expect(isCreationGenerating("processing")).toBe(true);
		expect(creationGpuWaitLabel("queued", 3)).toBe("QUEUED");
		expect(creationGpuWaitDetail("queued", 3)).toBe("3 in line");
		expect(creationGpuWaitDetail("queued")).toBe("");
		expect(creationGpuWaitLabel("processing")).toBe("Generating…");
		expect(isCreationGpuInFlight("queued")).toBe(true);
		expect(creationGpuWaitMarkup("queued", 2)).toContain("creation-wait-watch");
		expect(creationGpuWaitMarkup("queued", 2)).toContain("creation-wait-place");
		expect(creationGpuWaitMarkup("queued", 2)).toContain(">2<");
		expect(creationGpuWaitMarkup("queued", 2)).not.toContain("in line");
		expect(creationGpuWaitMarkup("processing")).toContain("creation-wait-gears");
		expect(creationGpuWaitMarkup("processing", 2)).not.toContain("creation-wait-place");
	});
});

describe("findCreationsPollStatusUpdates", () => {
	function mediaEl(id, status, place) {
		return {
			getAttribute(name) {
				if (name === "data-image-id") return id;
				if (name === "data-status") return status;
				if (name === "data-line-place") return place == null ? null : String(place);
				return null;
			},
		};
	}

	function rootWith(mediaEls) {
		return {
			querySelectorAll(sel) {
				return sel.includes("route-media") ? mediaEls : [];
			},
		};
	}

	test("repaints queued tiles when line_place arrives", () => {
		const updates = findCreationsPollStatusUpdates(
			[{ id: 30071, status: "queued", meta: { line_place: 2 } }],
			rootWith([mediaEl("30071", "queued")]),
		);
		expect(updates).toHaveLength(1);
		expect(updates[0].creationId).toBe("30071");
	});

	test("skips queued tiles when line_place is unchanged", () => {
		const updates = findCreationsPollStatusUpdates(
			[{ id: 30071, status: "queued", meta: { line_place: 2 } }],
			rootWith([mediaEl("30071", "queued", 2)]),
		);
		expect(updates).toHaveLength(0);
	});
});
