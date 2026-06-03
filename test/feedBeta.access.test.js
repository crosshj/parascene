import { describe, expect, test } from "@jest/globals";
import {
	canAccessFeedBeta,
	feedBetaEnabledForClient,
	isFeedBetaOptedIn
} from "../api_routes/feedBeta/access.js";

describe("feedBeta access", () => {
	test("denies admins without meta flag", () => {
		expect(canAccessFeedBeta({ role: "admin", meta: {} })).toBe(false);
	});

	test("allows consumers when feedBetaEnabled is true", () => {
		expect(canAccessFeedBeta({ role: "consumer", meta: { feedBetaEnabled: true } })).toBe(
			true
		);
	});

	test("denies consumers when flag is false or missing", () => {
		expect(canAccessFeedBeta({ role: "consumer", meta: {} })).toBe(false);
		expect(canAccessFeedBeta({ role: "consumer", meta: { feedBetaEnabled: false } })).toBe(
			false
		);
	});

	test("denies beta feed when forceLegacyFeed is true", () => {
		expect(
			canAccessFeedBeta({
				role: "consumer",
				meta: { feedBetaEnabled: true, forceLegacyFeed: true }
			})
		).toBe(false);
	});

	test("isFeedBetaOptedIn remains true when forceLegacyFeed is set", () => {
		const user = { role: "consumer", meta: { feedBetaEnabled: true, forceLegacyFeed: true } };
		expect(isFeedBetaOptedIn(user)).toBe(true);
		expect(canAccessFeedBeta(user)).toBe(false);
	});

	test("feedBetaEnabledForClient matches canAccessFeedBeta", () => {
		const user = { role: "consumer", meta: { feedBetaEnabled: true } };
		expect(feedBetaEnabledForClient(user)).toBe(canAccessFeedBeta(user));
	});
});
