import assert from "node:assert/strict";
import test from "node:test";
import { adminUserActivityAt } from "../server/routes/adminUsers.js";

test("a signup with no later activity counts as active at signup", () => {
	assert.equal(adminUserActivityAt({ created_at: "2026-11-19T16:11:00.000Z", last_active_at: null }), "2026-11-19T16:11:00.000Z");
});

test("later activity stays ahead of signup", () => {
	assert.equal(adminUserActivityAt({
		created_at: "2026-11-01T00:00:00.000Z",
		last_active_at: "2026-11-19T15:00:00.000Z"
	}), "2026-11-19T15:00:00.000Z");
});

test("a current presence beat beats a stale last-active column", () => {
	assert.equal(adminUserActivityAt({
		created_at: "2026-01-31T20:53:49.000Z",
		last_active_at: "2026-11-08T20:03:03.000Z",
		meta: { presence_last_seen_at: "2026-11-19T17:18:37.000Z" }
	}), "2026-11-19T17:18:37.000Z");
});
