import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import { createWelcomeGate } from "../server/routes/middleware/welcomeGate.js";
import createProfileRoutes from "../server/routes/profile.js";

function response() {
	return {
		statusCode: 200,
		body: null,
		location: "",
		status(code) { this.statusCode = code; return this; },
		json(body) { this.body = body; return this; },
		redirect(url) { this.statusCode = 302; this.location = url; return this; }
	};
}

function gateFor(profileRow, role = "consumer") {
	return createWelcomeGate({
		selectUserById: { get: async () => ({ id: 9, role }) },
		selectUserProfileByUserId: { get: async () => profileRow }
	});
}

test("welcome gate sends a new account to welcome and blocks app APIs", async () => {
	const gate = gateFor(null);
	const page = response();
	let continued = false;
	await gate({ auth: { userId: 9 }, method: "GET", path: "/feed", originalUrl: "/feed?tab=1" }, page, () => { continued = true; });
	assert.equal(continued, false);
	assert.equal(page.statusCode, 302);
	assert.equal(page.location, "/welcome?returnUrl=" + encodeURIComponent("/feed?tab=1"));

	const api = response();
	await gate({ auth: { userId: 9 }, method: "GET", path: "/api/home/newbies", originalUrl: "/api/home/newbies" }, api, () => { continued = true; });
	assert.equal(continued, false);
	assert.equal(api.statusCode, 409);
	assert.equal(api.body.error, "WELCOME_REQUIRED");
});

test("welcome gate leaves welcome, profile save, and finished accounts alone", async () => {
	const gate = gateFor(null);
	for (const path of ["/welcome", "/welcome/welcome.js", "/api/profile", "/typography.css", "/finance", "/finance/"]) {
		const res = response();
		let continued = false;
		await gate({ auth: { userId: 9 }, method: "GET", path, originalUrl: path }, res, () => { continued = true; });
		assert.equal(continued, true, path);
	}
	const put = response();
	let putContinued = false;
	await gate({ auth: { userId: 9 }, method: "PUT", path: "/api/profile", originalUrl: "/api/profile" }, put, () => { putContinued = true; });
	assert.equal(putContinued, true);
	const ledgerPut = response();
	let ledgerContinued = false;
	await gate({ auth: { userId: 9 }, method: "PUT", path: "/finance/api/ledger", originalUrl: "/finance/api/ledger" }, ledgerPut, () => { ledgerContinued = true; });
	assert.equal(ledgerContinued, true);

	const done = gateFor({ user_name: "ada", meta: { welcome_version: 1 } });
	const home = response();
	let homeContinued = false;
	await done({ auth: { userId: 9 }, method: "GET", path: "/", originalUrl: "/" }, home, () => { homeContinued = true; });
	assert.equal(homeContinued, true);

	const admin = gateFor(null, "admin");
	const adminHome = response();
	let adminContinued = false;
	await admin({ auth: { userId: 1 }, method: "GET", path: "/users", originalUrl: "/users" }, adminHome, () => { adminContinued = true; });
	assert.equal(adminContinued, true);
});

test("PUT /api/profile welcome_complete publishes the portrait", async () => {
	const published = [];
	const feeds = [];
	const inserted = [];
	let profile = null;
	const queries = {
		selectUserById: { get: async () => ({ id: 9, email: "new@example.com", role: "consumer", meta: {} }) },
		selectUserProfileByUserId: { get: async () => profile },
		selectUserProfileByUsername: { get: async () => null },
		upsertUserProfile: { run: async (_id, payload) => { profile = { user_id: 9, ...payload }; } },
		selectTryRequestsByCid: { all: async () => [] },
		selectCreatedImageAnonByFilename: { get: async () => ({ id: 3, filename: "anon.png", status: "completed", meta: {} }) },
		insertCreatedImage: { run: async (...args) => { inserted.push(args); return { insertId: 77 }; } },
		publishCreatedImage: { run: async (...args) => { published.push(args); return { changes: 1 }; } },
		insertFeedItem: { run: async (...args) => { feeds.push(args); return { insertId: 1 }; } },
		updateTryRequestsTransitionedByCreatedImageAnonId: { run: async () => ({}) },
		deleteCreatedImageAnon: { run: async () => ({}) }
	};
	const storage = {
		getImageBufferAnon: async () => Buffer.from("not-a-real-image"),
		uploadImage: async (_buffer, filename) => `/api/images/created/${filename}`,
		deleteImageAnon: async () => {}
	};
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => { req.auth = { userId: 9 }; next(); });
	app.use(createProfileRoutes({ queries, storage, users: { invalidateCache() {} }, client: {} }));
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const port = server.address().port;
		const response = await fetch(`http://127.0.0.1:${port}/api/profile`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				user_name: "ada",
				display_name: "Ada",
				character_description: "A painter",
				avatar_url: "/api/try/images/anon.png",
				avatar_prompt: "Portrait of a painter",
				welcome_complete: true
			})
		});
		const body = await response.json();
		assert.equal(response.status, 200);
		assert.equal(body.ok, true);
		assert.equal(body.profile.user_name, "ada");
		assert.equal(inserted.length, 1);
		assert.equal(String(inserted[0][1]).startsWith("welcome_9_"), true);
		assert.equal(inserted[0][7].new_user, true);
		assert.equal(published.length, 1);
		assert.equal(published[0][2], "Welcome @ada");
		assert.equal(feeds.length, 1);
		assert.equal(feeds[0][0], "Welcome @ada");
		assert.equal(feeds[0][4], 77);
	} finally {
		await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	}
});
