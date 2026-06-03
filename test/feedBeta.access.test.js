import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canAccessFeedBeta, feedBetaEnabledForClient } from "../api_routes/feedBeta/access.js";

describe("feedBeta access", () => {
	it("denies admins without meta flag", () => {
		assert.equal(canAccessFeedBeta({ role: "admin", meta: {} }), false);
	});

	it("allows consumers when feedBetaEnabled is true", () => {
		assert.equal(
			canAccessFeedBeta({ role: "consumer", meta: { feedBetaEnabled: true } }),
			true
		);
	});

	it("denies consumers when flag is false or missing", () => {
		assert.equal(canAccessFeedBeta({ role: "consumer", meta: {} }), false);
		assert.equal(
			canAccessFeedBeta({ role: "consumer", meta: { feedBetaEnabled: false } }),
			false
		);
	});

	it("feedBetaEnabledForClient matches canAccessFeedBeta", () => {
		const user = { role: "consumer", meta: { feedBetaEnabled: true } };
		assert.equal(feedBetaEnabledForClient(user), canAccessFeedBeta(user));
	});
});
