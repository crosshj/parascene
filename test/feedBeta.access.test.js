import { describe, expect, test } from "@jest/globals";
import { canAccessFeedBeta } from "../api_routes/feedBeta/access.js";

describe("feedBeta access", () => {
	test("allows users by default", () => {
		expect(canAccessFeedBeta({ role: "admin", meta: {} })).toBe(true);
		expect(canAccessFeedBeta({ role: "consumer", meta: {} })).toBe(true);
	});

	test("denies beta feed when forceLegacyFeed is true", () => {
		expect(
			canAccessFeedBeta({
				role: "consumer",
				meta: { forceLegacyFeed: true }
			})
		).toBe(false);
	});

});
