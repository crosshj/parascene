import assert from "node:assert/strict";
import test from "node:test";
import { apiHostBoundary } from "../server/routes/middleware/apiHost.js";
import { shareHostBoundary } from "../server/routes/middleware/shareHost.js";

function request(host, path) {
	return {
		hostname: host,
		path,
		originalUrl: path,
		url: path,
		get(name) { return name.toLowerCase() === "host" ? host : ""; }
	};
}

function response() {
	return {
		statusCode: 200,
		redirectUrl: "",
		redirect(status, url) { this.statusCode = status; this.redirectUrl = url; return this; }
	};
}

test("beta API test alias serves API paths and redirects documents to beta", () => {
	const previous = process.env.APP_VERSION;
	const previousOrigin = process.env.APP_ORIGIN;
	process.env.APP_VERSION = "beta";
	process.env.APP_ORIGIN = "https://beta.parascene.com";
	try {
		let continued = false;
		apiHostBoundary(request("beta-api.parascene.com", "/api/example"), response(), () => { continued = true; });
		assert.equal(continued, true);

		const res = response();
		apiHostBoundary(request("beta-api.parascene.com", "/"), res, () => {});
		assert.equal(res.redirectUrl, "https://beta.parascene.com/");
	} finally {
		if (previous === undefined) delete process.env.APP_VERSION;
		else process.env.APP_VERSION = previous;
		if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
		else process.env.APP_ORIGIN = previousOrigin;
	}
});

test("beta share test alias serves share paths but redirects unrelated documents", () => {
	const previous = process.env.APP_VERSION;
	const previousOrigin = process.env.APP_ORIGIN;
	process.env.APP_VERSION = "beta";
	process.env.APP_ORIGIN = "https://beta.parascene.com";
	try {
		let continued = false;
		shareHostBoundary(request("beta-sh.parascene.com", "/s/v1/token"), response(), () => { continued = true; });
		assert.equal(continued, true);

		const res = response();
		shareHostBoundary(request("beta-sh.parascene.com", "/about"), res, () => {});
		assert.equal(res.redirectUrl, "https://beta.parascene.com/about");
	} finally {
		if (previous === undefined) delete process.env.APP_VERSION;
		else process.env.APP_VERSION = previous;
		if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
		else process.env.APP_ORIGIN = previousOrigin;
	}
});
