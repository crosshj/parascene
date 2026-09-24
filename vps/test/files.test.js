import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import { createCdnRoutes } from "../routes/cdn.js";
import { createFilesRoutes } from "../routes/files.js";
import { createCdnHostBoundary } from "../routes/middleware/cdnHost.js";
import { createFilesCors } from "../routes/middleware/filesCors.js";
import { mayDisplayInline, normalizeFileId, serializeFile } from "../routes/utils/files.js";

async function withServer(app, run) {
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	try {
		await run(`http://127.0.0.1:${address.port}`);
	} finally {
		await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	}
}

async function requestWithHost(base, path, host, headers = {}) {
	const target = new URL(path, base);
	return new Promise((resolve, reject) => {
		const request = http.request({
			hostname: target.hostname,
			port: target.port,
			path: target.pathname + target.search,
			headers: { ...headers, Host: host }
		}, (response) => {
			const chunks = [];
			response.on("data", (chunk) => chunks.push(chunk));
			response.on("end", () => resolve({
				status: response.statusCode,
				headers: response.headers,
				text: Buffer.concat(chunks).toString("utf8")
			}));
		});
		request.on("error", reject);
		request.end();
	});
}

function filesApp(profileFiles, { authenticated = true, cors = false } = {}) {
	const app = express();
	if (authenticated) app.use((req, _res, next) => { req.auth = { userId: 42 }; next(); });
	app.use("/api/files", ...(cors ? [createFilesCors()] : []), createFilesRoutes(profileFiles));
	return app;
}

test("normalizes only one safe storage basename", () => {
	assert.equal(normalizeFileId("misc_123_abc.pdf"), "misc_123_abc.pdf");
	for (const invalid of ["", ".", "..", "../other", "folder/file", "folder\\file", "x..y", "<file>"]) {
		assert.equal(normalizeFileId(invalid), null);
	}
});

test("serializes Supabase file metadata without exposing bucket or owner prefix", () => {
	assert.deepEqual(serializeFile({
		name: "misc_123_demo.mp4",
		created_at: "2026-09-20T12:00:00Z",
		updated_at: "2026-09-20T12:01:00Z",
		metadata: { mimetype: "video/mp4", size: 8192 }
	}), {
		id: "misc_123_demo.mp4",
		display_name: null,
		content_type: "video/mp4",
		size: 8192,
		created_at: "2026-09-20T12:00:00Z",
		updated_at: "2026-09-20T12:01:00Z",
		content_path: "/api/files/misc_123_demo.mp4/content"
	});
	assert.equal(mayDisplayInline("video/mp4"), true);
	assert.equal(mayDisplayInline("image/svg+xml"), false);
	assert.equal(mayDisplayInline("text/html"), false);
});

test("lists only through the authenticated user id", async () => {
	let call = null;
	const profileFiles = {
		async list(userId, options) {
			call = { userId, options };
			return [{ name: "misc_1_note.txt", metadata: { mimetype: "text/plain", size: 12 } }];
		}
	};
	await withServer(filesApp(profileFiles), async (base) => {
		const response = await fetch(`${base}/api/files?limit=25&offset=5`);
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.equal(body.files[0].id, "misc_1_note.txt");
		assert.deepEqual(call, { userId: 42, options: { limit: 25, offset: 5 } });
		assert.equal(response.headers.get("cache-control"), "private, no-store");
	});
});

test("rejects an unauthenticated list", async () => {
	await withServer(filesApp({}, { authenticated: false }), async (base) => {
		const response = await fetch(`${base}/api/files`);
		assert.equal(response.status, 401);
	});
});

test("streams a file for the authenticated owner and forwards range", async () => {
	let call = null;
	const bytes = new TextEncoder().encode("personal file");
	const profileFiles = {
		async fetch(userId, fileId, options) {
			call = { userId, fileId, range: options.range };
			return new Response(bytes, {
				status: 206,
				headers: {
					"Content-Type": "text/plain; charset=utf-8",
					"Content-Length": String(bytes.length),
					"Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
					"Accept-Ranges": "bytes"
				}
			});
		}
	};
	await withServer(filesApp(profileFiles), async (base) => {
		const response = await fetch(`${base}/api/files/misc_1_note.txt/content`, {
			headers: { Range: "bytes=0-12" }
		});
		assert.equal(response.status, 206);
		assert.equal(await response.text(), "personal file");
		assert.deepEqual(call, { userId: 42, fileId: "misc_1_note.txt", range: "bytes=0-12" });
		assert.match(response.headers.get("content-disposition"), /^attachment;/);
		assert.equal(response.headers.get("x-content-type-options"), "nosniff");
	});
});

test("allows credentialed beta CORS and rejects other origins", async () => {
	const profileFiles = { async list() { return []; } };
	await withServer(filesApp(profileFiles, { cors: true }), async (base) => {
		const allowed = await fetch(`${base}/api/files`, { headers: { Origin: "https://beta.parascene.com" } });
		assert.equal(allowed.status, 200);
		assert.equal(allowed.headers.get("access-control-allow-origin"), "https://beta.parascene.com");
		assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");

		const denied = await fetch(`${base}/api/files`, { headers: { Origin: "https://evil.example" } });
		assert.equal(denied.status, 403);
	});
});

test("cdn host exposes CDN routes but never falls through to the beta app", async () => {
	const profileFiles = { async list() { return []; } };
	const app = express();
	app.use((req, _res, next) => { req.auth = { userId: 42 }; next(); });
	app.use(createCdnHostBoundary(createCdnRoutes(profileFiles)));
	app.get("*", (_req, res) => res.type("text").send("beta app"));

	await withServer(app, async (base) => {
		const health = await requestWithHost(base, "/healthz", "cdn.parascene.com");
		assert.equal(health.status, 200);
		assert.deepEqual(JSON.parse(health.text), { ok: true, service: "parascene-cdn" });

		const files = await requestWithHost(base, "/api/files", "cdn.parascene.com");
		assert.equal(files.status, 200);

		const root = await requestWithHost(base, "/", "cdn.parascene.com");
		assert.equal(root.status, 404);
		assert.match(root.text, /CDN service/);
		const forwardedSpoof = await requestWithHost(base, "/", "cdn.parascene.com", {
			"X-Forwarded-Host": "beta.parascene.com"
		});
		assert.equal(forwardedSpoof.status, 404);

		const beta = await requestWithHost(base, "/files", "beta.parascene.com");
		assert.equal(beta.status, 200);
		assert.equal(beta.text, "beta app");
	});
});
