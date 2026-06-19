import { describe, expect, test } from "@jest/globals";
import {
	buildFeedImpressionSnapshot,
	computeConcentrationMetrics,
	feedImpressionCreationHitsKey,
	feedImpressionDayScanPattern,
	feedImpressionUserHashKey
} from "../api_routes/utils/feedImpressionPulse.js";

describe("feedImpressionPulse keys", () => {
	test("uses pulse day partition prefix", () => {
		expect(feedImpressionUserHashKey("2026-06-19", 42)).toBe(
			"pulse:feed-impression:day:2026-06-19:u:42"
		);
		expect(feedImpressionDayScanPattern("2026-06-19")).toBe(
			"pulse:feed-impression:day:2026-06-19:u:*"
		);
		expect(feedImpressionCreationHitsKey("2026-06-19")).toBe(
			"pulse:feed-impression:creation-hits:2026-06-19"
		);
	});
});

describe("computeConcentrationMetrics", () => {
	test("even split has low concentration", () => {
		const m = computeConcentrationMetrics([10, 10, 10, 10]);
		expect(m.participants).toBe(4);
		expect(m.top1_share).toBe(0.25);
		expect(m.gini).toBe(0);
		expect(m.effective_n).toBe(4);
	});

	test("skewed split has high top1 and gini", () => {
		const m = computeConcentrationMetrics([90, 5, 5]);
		expect(m.top1_share).toBe(0.9);
		expect(m.top2_share).toBe(0.95);
		expect(m.gini).toBeGreaterThan(0.5);
		expect(m.effective_n).toBeLessThan(2);
	});
});

describe("buildFeedImpressionSnapshot", () => {
	test("aggregates counts and concentration without per-entity lists", () => {
		const snap = buildFeedImpressionSnapshot(
			[
				{ dwell_impressions: 10, click_impressions: 2, total_impressions: 12 },
				{ dwell_impressions: 5, click_impressions: 0, total_impressions: 5 }
			],
			[8, 5, 4]
		);
		expect(snap.unique_impressors).toBe(2);
		expect(snap.total_impressions).toBe(17);
		expect(snap.dwell_impressions).toBe(15);
		expect(snap.click_impressions).toBe(2);
		expect(snap.unique_creations).toBe(3);
		expect(snap.concentration.users.participants).toBe(2);
		expect(snap.concentration.creations.participants).toBe(3);
		expect(snap.impressors).toBeUndefined();
	});
});
