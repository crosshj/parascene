import express from "express";
import { Readable } from "node:stream";
import { requireAuth } from "./middleware/auth.js";
import { contentDisposition, mayDisplayInline, normalizeFileId, safeDispositionFilename, serializeFile } from "./utils/files.js";
import { filesOriginForRequest } from "./utils/origins.js";
import { createPublicFileToken, verifyPublicFileToken } from "./utils/publicFileLinks.js";
import {
	createFileId,
	createSizeLimitedStream,
	MAX_UPLOAD_BYTES,
	normalizeOriginalFilename,
	uploadContentType
} from "./utils/uploads.js";

function boundedInteger(value, fallback, min, max) {
	const parsed = Number.parseInt(String(value ?? ""), 10);
	return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function copyHeader(upstream, res, name) {
	const value = upstream.headers.get(name);
	if (value) res.set(name, value);
}

function upstreamErrorStatus(status) {
	if (status === 400 || status === 404) return 404;
	if (status === 401 || status === 403) return 502;
	return status >= 400 && status < 600 ? status : 502;
}

function setFileContentPolicy(res, inline) {
	if (inline) {
		res.set("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; media-src 'self'");
	} else {
		res.set("Content-Security-Policy", "default-src 'none'; sandbox");
	}
}

function publicFileUrl(req, userId, file, secret) {
	const filename = file.display_name || file.id;
	const token = createPublicFileToken(userId, file.id, filename, secret);
	if (!token) return null;
	const origin = filesOriginForRequest(req) || "https://cdn.parascene.com";
	return `${origin}/s/${token}/${encodeURIComponent(filename)}`;
}

export function createFilesRoutes(profileFiles, { publicLinkSecret = process.env.SESSION_SECRET } = {}) {
	const router = express.Router();

	router.use(requireAuth);
	router.post("/", async (req, res, next) => {
		const originalName = normalizeOriginalFilename(req.query.filename);
		if (!originalName) {
			return res.status(400).json({ error: "Bad request", message: "A valid filename is required" });
		}
		const declaredBytes = Number(req.get("content-length"));
		if (Number.isFinite(declaredBytes) && declaredBytes > MAX_UPLOAD_BYTES) {
			return res.status(413).json({ error: "File too large", max_bytes: MAX_UPLOAD_BYTES });
		}
		if (declaredBytes === 0) {
			return res.status(400).json({ error: "Bad request", message: "The file is empty" });
		}

		const fileId = createFileId(originalName);
		const contentType = uploadContentType(originalName, req.get("content-type"));
		const upload = createSizeLimitedStream(req);
		try {
			await profileFiles.upload(req.auth.userId, fileId, upload.stream, { contentType, originalName });
			if (upload.bytesRead === 0) {
				await profileFiles.delete(req.auth.userId, fileId).catch(() => undefined);
				return res.status(400).json({ error: "Bad request", message: "The file is empty" });
			}
			const file = serializeFile({
				name: fileId,
				created_at: new Date().toISOString(),
				metadata: { mimetype: contentType, originalName, size: upload.bytesRead }
			});
			res.set("Cache-Control", "private, no-store");
			return res.status(201).json({ file: { ...file, public_url: publicFileUrl(req, req.auth.userId, file, publicLinkSecret) } });
		} catch (error) {
			await profileFiles.delete(req.auth.userId, fileId).catch(() => undefined);
			if (upload.exceeded) {
				return res.status(413).json({ error: "File too large", max_bytes: MAX_UPLOAD_BYTES });
			}
			if (req.aborted) return undefined;
			return next(error);
		}
	});

	router.get("/", async (req, res, next) => {
		try {
			const limit = boundedInteger(req.query.limit, 50, 1, 100);
			const offset = boundedInteger(req.query.offset, 0, 0, 100000);
			const rows = await profileFiles.list(req.auth.userId, { limit, offset });
			const files = rows.map(serializeFile).filter(Boolean).map((file) => ({
				...file,
				public_url: publicFileUrl(req, req.auth.userId, file, publicLinkSecret)
			}));
			res.set("Cache-Control", "private, no-store");
			return res.json({
				files,
				pagination: {
					limit,
					offset,
					next_offset: rows.length === limit ? offset + limit : null
				}
			});
		} catch (error) {
			return next(error);
		}
	});

	router.delete("/:fileId", async (req, res, next) => {
		const fileId = normalizeFileId(req.params.fileId);
		if (!fileId) return res.status(400).json({ error: "Invalid file id" });
		try {
			await profileFiles.delete(req.auth.userId, fileId);
			res.set("Cache-Control", "private, no-store");
			return res.sendStatus(204);
		} catch (error) {
			return next(error);
		}
	});

	async function sendContent(req, res, next) {
		const fileId = normalizeFileId(req.params.fileId);
		if (!fileId) return res.status(400).json({ error: "Invalid file id" });
		const controller = new AbortController();
		res.on("close", () => {
			if (!res.writableEnded) controller.abort();
		});
		try {
			const upstream = await profileFiles.fetch(req.auth.userId, fileId, {
				method: req.method,
				range: req.get("range") || undefined,
				signal: controller.signal
			});
			if (!upstream.ok) {
				return res.status(upstreamErrorStatus(upstream.status)).json({ error: "File not found" });
			}
			res.status(upstream.status);
			for (const header of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
				copyHeader(upstream, res, header);
			}
			const contentType = upstream.headers.get("content-type") || "application/octet-stream";
			res.set("Content-Type", contentType);
			res.set("Cache-Control", "private, no-store");
			res.set("X-Content-Type-Options", "nosniff");
			const mode = mayDisplayInline(contentType) ? "inline" : "attachment";
			setFileContentPolicy(res, mode === "inline");
			res.set("Content-Disposition", `${mode}; filename="${safeDispositionFilename(fileId)}"`);
			if (req.method === "HEAD" || !upstream.body) return res.end();
			Readable.fromWeb(upstream.body).on("error", (error) => res.destroy(error)).pipe(res);
			return undefined;
		} catch (error) {
			if (error?.name === "AbortError") return undefined;
			return next(error);
		}
	}

	router.get("/:fileId/content", sendContent);
	router.head("/:fileId/content", sendContent);
	return router;
}

export function createPublicFileRoutes(profileFiles, { publicLinkSecret = process.env.SESSION_SECRET } = {}) {
	const router = express.Router();
	router.use((_req, res, next) => {
		res.set("Cache-Control", "private, no-store");
		res.set("Cloudflare-CDN-Cache-Control", "no-store");
		next();
	});
	// The signed token is the authorization for this route. It must work without
	// a session cookie because cross-origin <img>/<video>/<audio> requests do not
	// send the beta session cookie by default.

	async function sendPublicContent(req, res, next) {
		const grant = verifyPublicFileToken(req.params.token, req.params.filename, publicLinkSecret);
		if (!grant) return res.status(404).type("text").send("File not found");
		const controller = new AbortController();
		res.on("close", () => {
			if (!res.writableEnded) controller.abort();
		});
		try {
			const upstream = await profileFiles.fetch(grant.userId, grant.fileId, {
				method: req.method,
				range: req.get("range") || undefined,
				signal: controller.signal
			});
			if (!upstream.ok) return res.status(upstreamErrorStatus(upstream.status)).type("text").send("File not found");
			res.status(upstream.status);
			for (const header of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
				copyHeader(upstream, res, header);
			}
			const contentType = upstream.headers.get("content-type") || "application/octet-stream";
			res.set("Content-Type", contentType);
			res.set("Cache-Control", "private, no-store");
			res.set("X-Content-Type-Options", "nosniff");
			const mode = mayDisplayInline(contentType) ? "inline" : "attachment";
			setFileContentPolicy(res, mode === "inline");
			res.set("Content-Disposition", contentDisposition(mode, grant.filename));
			if (req.method === "HEAD" || !upstream.body) return res.end();
			Readable.fromWeb(upstream.body).on("error", (error) => res.destroy(error)).pipe(res);
			return undefined;
		} catch (error) {
			if (error?.name === "AbortError") return undefined;
			return next(error);
		}
	}

	router.get("/:token/:filename", sendPublicContent);
	router.head("/:token/:filename", sendPublicContent);
	return router;
}
