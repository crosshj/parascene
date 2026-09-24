import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import { createProfileFilesStore } from "../db/profileFiles.js";
import express from "express";
import { createCdnRoutes } from "../routes/cdn.js";
import { createFilesRoutes, createPublicFileRoutes } from "../routes/files.js";
import { createGenericRoutes } from "../routes/generic.js";
import { createCdnHostBoundary } from "../routes/middleware/cdnHost.js";
import { createFilesCors } from "../routes/middleware/filesCors.js";
import { mayDisplayInline, normalizeFileId, serializeFile } from "../routes/utils/files.js";
import { createSizeLimitedStream, MAX_UPLOAD_BYTES, normalizeOriginalFilename, uploadContentType } from "../routes/utils/uploads.js";
import { createPublicFileToken } from "../routes/utils/publicFileLinks.js";

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

test("normalizes upload metadata without accepting client paths", () => {
	assert.equal(normalizeOriginalFilename("demo video.mp4"), "demo video.mp4");
	assert.equal(normalizeOriginalFilename("folder/demo.mp4"), null);
	assert.equal(normalizeOriginalFilename("folder\\demo.mp4"), null);
	assert.equal(uploadContentType("demo.mp4", "application/octet-stream"), "video/mp4");
	assert.equal(uploadContentType("demo.mp4", "application/mp4"), "video/mp4");
	assert.equal(MAX_UPLOAD_BYTES, 50 * 1024 * 1024);
});

test("stops an upload stream after the observed byte limit", async () => {
	const upload = createSizeLimitedStream(Readable.from([Buffer.alloc(4), Buffer.alloc(4)]), 7);
	await assert.rejects(async () => {
		for await (const _chunk of upload.stream) { /* Consume the bounded stream. */ }
	}, /file-size limit/);
	assert.equal(upload.exceeded, true);
	assert.equal(upload.bytesRead, 8);
});

test("scopes storage mutations to the authenticated user's profile prefix", async () => {
	const calls = [];
	const bucket = {
		async upload(path, body, options) {
			calls.push({ operation: "upload", path, body, options });
			return { data: { path }, error: null };
		},
		async remove(paths) {
			calls.push({ operation: "remove", paths });
			return { data: [], error: null };
		}
	};
	const client = { storage: { from(name) { assert.equal(name, "prsn_misc"); return bucket; } } };
	const store = createProfileFilesStore({ client, supabaseUrl: "https://example.supabase.co", serviceRoleKey: "secret" });
	const body = {};
	await store.upload(42, "misc_1_test.mp4", body, { contentType: "video/mp4", originalName: "test.mp4" });
	await store.delete(42, "misc_1_test.mp4");
	assert.equal(calls[0].path, "profile/42/misc_1_test.mp4");
	assert.equal(calls[0].body, body);
	assert.deepEqual(calls[1], { operation: "remove", paths: ["profile/42/misc_1_test.mp4"] });
});

test("streams an upload to the authenticated user's generated object", async () => {
	let call = null;
	const profileFiles = {
		async upload(userId, fileId, body, options) {
			const chunks = [];
			for await (const chunk of body) chunks.push(chunk);
			call = { userId, fileId, bytes: Buffer.concat(chunks).toString("utf8"), options };
		},
		async delete() {
			assert.fail("a successful upload should not be cleaned up");
		}
	};
	await withServer(filesApp(profileFiles), async (base) => {
		const response = await fetch(`${base}/api/files?filename=${encodeURIComponent("My clip.mp4")}`, {
			method: "POST",
			headers: { "Content-Type": "video/mp4" },
			body: "video bytes"
		});
		assert.equal(response.status, 201);
		const body = await response.json();
		assert.equal(body.file.display_name, "My clip.mp4");
		assert.equal(body.file.content_type, "video/mp4");
		assert.equal(body.file.size, 11);
		assert.match(body.file.id, /^misc_\d+_[A-Za-z0-9_-]{8}_fn_[A-Za-z0-9_-]+\.mp4$/);
		assert.deepEqual(call, {
			userId: 42,
			fileId: body.file.id,
			bytes: "video bytes",
			options: { contentType: "video/mp4", originalName: "My clip.mp4" }
		});
	});
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

test("preserves original names from storage metadata variants", () => {
	assert.equal(serializeFile({ name: "misc_1_file.mp4", metadata: JSON.stringify({ original_name: "clip.mp4", mimetype: "video/mp4" }) }).display_name, "clip.mp4");
	assert.equal(serializeFile({ name: "misc_1_file.mp4", metadata: { metadata: { originalName: "photo.jpg" } } }).display_name, "photo.jpg");
});

test("rejects an unauthenticated list", async () => {
	await withServer(filesApp({}, { authenticated: false }), async (base) => {
		const response = await fetch(`${base}/api/files`);
		assert.equal(response.status, 401);
	});
});

test("deletes only through the authenticated user id", async () => {
	let call = null;
	const profileFiles = {
		async delete(userId, fileId) {
			call = { userId, fileId };
		}
	};
	await withServer(filesApp(profileFiles), async (base) => {
		const response = await fetch(`${base}/api/files/misc_1_test.mp4`, { method: "DELETE" });
		assert.equal(response.status, 204);
		assert.deepEqual(call, { userId: 42, fileId: "misc_1_test.mp4" });

		const invalid = await fetch(`${base}/api/files/bad..mp4`, { method: "DELETE" });
		assert.equal(invalid.status, 400);
		assert.deepEqual(call, { userId: 42, fileId: "misc_1_test.mp4" });
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

test("streams a signed share link without a session cookie", async () => {
	const profileFiles = {
		async fetch(userId, fileId, options) {
			assert.equal(userId, 42);
			assert.equal(fileId, "misc_1_test.mp4");
			assert.equal(options.range, "bytes=0-3");
			return new Response(new TextEncoder().encode("test"), {
				status: 206,
				headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-3/4" }
			});
		}
	};
	const secret = "test-public-link-secret";
	const token = createPublicFileToken(42, "misc_1_test.mp4", "clip.mp4", secret);
	const app = express();
	app.use("/s", createPublicFileRoutes(profileFiles, { publicLinkSecret: secret }));
	await withServer(app, async (base) => {
		const response = await fetch(`${base}/s/${token}/clip.mp4`, { headers: { Origin: "https://beta.parascene.com", Range: "bytes=0-3" } });
		assert.equal(response.status, 206);
		assert.equal(response.headers.get("access-control-allow-origin"), "https://beta.parascene.com");
		assert.equal(await response.text(), "test");
	});
});

test("allows credentialed beta CORS and rejects other origins", async () => {
	const profileFiles = { async list() { return []; } };
	await withServer(filesApp(profileFiles, { cors: true }), async (base) => {
		const allowed = await fetch(`${base}/api/files`, { headers: { Origin: "https://beta.parascene.com" } });
		assert.equal(allowed.status, 200);
		assert.equal(allowed.headers.get("access-control-allow-origin"), "https://beta.parascene.com");
		assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
		const preflight = await fetch(`${base}/api/files`, {
			method: "OPTIONS",
			headers: { Origin: "https://beta.parascene.com", "Access-Control-Request-Method": "POST" }
		});
		assert.equal(preflight.status, 204);
		assert.match(preflight.headers.get("access-control-allow-methods"), /POST/);
		assert.match(preflight.headers.get("access-control-allow-methods"), /DELETE/);

		const denied = await fetch(`${base}/api/files`, { headers: { Origin: "https://evil.example" } });
		assert.equal(denied.status, 403);
		const www = await fetch(`${base}/api/files`, { headers: { Origin: "https://www.parascene.com" } });
		assert.equal(www.status, 200);
		assert.equal(www.headers.get("access-control-allow-origin"), "https://www.parascene.com");
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

test("compatibility generic route preserves upload URL shape and owner delete", async () => {
	const calls = [];
	const genericFiles = {
		async upload(key, body, options) {
			const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
			calls.push({ operation: "upload", key, bytes: bytes.toString(), options });
		},
		async remove(key) { calls.push({ operation: "remove", key }); },
		async fetch() { return new Response(new TextEncoder().encode("image"), { status: 200 }); }
	};
	const users = { async byId() { return { role: "consumer", meta: {} }; } };
	const app = express();
	app.use((req, _res, next) => { req.auth = { userId: 42 }; next(); });
	app.use("/api/images/generic", createGenericRoutes(genericFiles, users));

	await withServer(app, async (base) => {
		const response = await fetch(`${base}/api/images/generic`, {
			method: "POST",
			headers: {
				"Content-Type": "image/png",
				"X-upload-kind": "generic",
				"X-upload-name": "avatar.png"
			},
			body: "image bytes"
		});
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.match(body.key, /^profile\/42\/generic_\d+_[A-Za-z0-9_-]+\.png$/);
		assert.match(body.url, new RegExp(`^https://cdn\\.parascene\\.com/api/images/generic/profile/42/${body.key.split("/").at(-1)}$`));
		assert.equal(calls[0].bytes, "image bytes");
		assert.equal(calls[0].options.contentType, "image/png");

		const deleted = await fetch(`${base}/api/images/generic/${body.key.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
		assert.equal(deleted.status, 200);
		assert.deepEqual(calls[1], { operation: "remove", key: body.key });
	});
});

test("compatibility generic route allows public profile reads and requires auth for other keys", async () => {
	const genericFiles = {
		async upload() {},
		async remove() {},
		async fetch(key) {
			return new Response(new TextEncoder().encode(key), { status: 200, headers: { "Content-Type": "image/png" } });
		}
	};
	const users = { async byId() { return { role: "consumer", meta: {} }; } };
	const app = express();
	app.use("/api/images/generic", createGenericRoutes(genericFiles, users));
	await withServer(app, async (base) => {
		const profile = await fetch(`${base}/api/images/generic/profile/42/avatar.png`);
		assert.equal(profile.status, 200);
		assert.equal(await profile.text(), "profile/42/avatar.png");
		const privateRead = await fetch(`${base}/api/images/generic/share-audio/private.mp3`);
		assert.equal(privateRead.status, 401);
	});
});
