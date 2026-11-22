import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { createUnhandledRequestLog } from "../server/db/unhandledRequests.js";
import { createUnhandledRequestMiddleware } from "../server/routes/middleware/unhandledRequest.js";
import { describeUnhandledRequest, unhandledPathKey } from "../server/services/http/unhandledRequest.js";

test("path keys collapse ids and long tokens", () => {
	assert.equal(unhandledPathKey("/api/creations/42/summary"), "/api/creations/:id/summary");
	assert.equal(
		unhandledPathKey("/api/creations/6b9f1c2a-3d4e-4f5a-8b6c-7d8e9f0a1b2c/summary"),
		"/api/creations/:id/summary"
	);
	assert.equal(unhandledPathKey("/api/worker/jobs"), "/api/worker/jobs");
	assert.equal(unhandledPathKey("/api/profile/comment-stickers"), "/api/profile/comment-stickers");
	assert.equal(unhandledPathKey("/oauth/token/abcdefghijklmnopqrstuvwxyz012345"), "/oauth/token/:id");
});

test("a description keeps query key names and drops values", () => {
	const entry = describeUnhandledRequest({
		method: "POST",
		path: "/api/webhooks/stripe",
		hostname: "api.parascene.com",
		query: { token: "secret-value", job_type: "visit_pulse_flush" },
		headers: { "user-agent": "QStash" },
		get(name) {
			return name.toLowerCase() === "user-agent" ? "QStash" : "";
		}
	}, "production");
	assert.equal(entry.method, "POST");
	assert.equal(entry.path_key, "/api/webhooks/stripe");
	assert.equal(entry.host, "api.parascene.com");
	assert.equal(entry.app_version, "production");
	assert.equal(entry.query_keys, "job_type,token");
	assert.equal(JSON.stringify(entry).includes("secret-value"), false);
	assert.equal(describeUnhandledRequest({ method: "GET", path: "/wp-admin", hostname: "api.parascene.com", query: {}, get() { return ""; } }), null);
});

test("unmatched API requests are recorded and handled routes are not", async () => {
	const seen = [];
	const app = express();
	app.get("/api/health", (_req, res) => res.json({ ok: true }));
	app.use(createUnhandledRequestMiddleware({
		log: { record(entry) { seen.push(entry); } },
		appVersion: "production"
	}));
	const server = await new Promise((resolve) => {
		const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
	});
	try {
		const port = server.address().port;
		const missed = await fetch(`http://127.0.0.1:${port}/api/worker/jobs?token=secret`, { method: "POST" });
		assert.equal(missed.status, 404);
		assert.deepEqual(await missed.json(), { error: "Not found" });
		assert.equal(seen.length, 1);
		assert.equal(seen[0].method, "POST");
		assert.equal(seen[0].path_key, "/api/worker/jobs");
		assert.equal(seen[0].query_keys, "token");
		assert.equal(JSON.stringify(seen[0]).includes("secret"), false);
		assert.equal(seen[0].app_version, "production");

		seen.length = 0;
		const ok = await fetch(`http://127.0.0.1:${port}/api/health`);
		assert.equal(ok.status, 200);
		assert.equal(seen.length, 0);

		const page = await fetch(`http://127.0.0.1:${port}/wp-admin`);
		assert.equal(page.status, 404);
		assert.equal(seen.length, 0);
	} finally {
		server.close();
		if (typeof server.closeAllConnections === "function") server.closeAllConnections();
		await once(server, "close");
	}
});

test("flushes add to the existing row for the same path", async () => {
	const rows = new Map();
	let nextId = 1;
	const client = {
		from() {
			const filters = [];
			const api = {
				select() { return api; },
				eq(column, value) {
					filters.push([column, value]);
					return api;
				},
				maybeSingle: async () => {
					const key = ["method", "path_key", "host", "app_version"].map((column) => filters.find(([name]) => name === column)?.[1]).join("\n");
					return { data: rows.get(key) || null, error: null };
				},
				update(values) {
					return {
						eq(_column, value) {
							const row = [...rows.values()].find((item) => item.id === value);
							if (row) Object.assign(row, values);
							return Promise.resolve({ error: null });
						}
					};
				},
				insert: async (row) => {
					const saved = { id: nextId, ...row };
					nextId += 1;
					rows.set([saved.method, saved.path_key, saved.host, saved.app_version].join("\n"), saved);
					return { error: null };
				}
			};
			return api;
		}
	};
	let clock = new Date("2026-11-22T06:00:00.000Z");
	const log = createUnhandledRequestLog({ client, now: () => clock, flushIntervalMs: 60_000 });
	const entry = { method: "POST", path_key: "/api/worker/jobs", host: "api.parascene.com", app_version: "production", query_keys: "", user_agent: "QStash" };
	log.record(entry);
	log.record(entry);
	await log.flush();
	const prod = rows.get("POST\n/api/worker/jobs\napi.parascene.com\nproduction");
	assert.equal(prod.hit_count, 2);

	clock = new Date("2026-11-22T06:05:00.000Z");
	log.record(entry);
	await log.flush();
	assert.equal(prod.hit_count, 3);
	assert.equal(prod.first_seen_at, "2026-11-22T06:00:00.000Z");
	assert.equal(prod.last_seen_at, "2026-11-22T06:05:00.000Z");

	log.record({ ...entry, app_version: "beta" });
	await log.flush();
	assert.equal(rows.get("POST\n/api/worker/jobs\napi.parascene.com\nbeta").hit_count, 1);
	assert.equal(prod.hit_count, 3);
});
