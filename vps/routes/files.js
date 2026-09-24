import express from "express";
import { Readable } from "node:stream";
import { requireAuth } from "./middleware/auth.js";
import { mayDisplayInline, normalizeFileId, safeDispositionFilename, serializeFile } from "./utils/files.js";

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

export function createFilesRoutes(profileFiles) {
	const router = express.Router();

	router.use(requireAuth);
	router.get("/", async (req, res, next) => {
		try {
			const limit = boundedInteger(req.query.limit, 50, 1, 100);
			const offset = boundedInteger(req.query.offset, 0, 0, 100000);
			const rows = await profileFiles.list(req.auth.userId, { limit, offset });
			const files = rows.map(serializeFile).filter(Boolean);
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
			res.set("Content-Security-Policy", "default-src 'none'; sandbox");
			const mode = mayDisplayInline(contentType) ? "inline" : "attachment";
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
