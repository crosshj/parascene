import crypto from "node:crypto";
import express from "express";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { requireAuth } from "./middleware/auth.js";
import { createSizeLimitedStream, MAX_UPLOAD_BYTES } from "./utils/uploads.js";
import { contentTypeForFile, mayDisplayInline } from "./utils/files.js";

const DEFAULT_CDN_ORIGIN = "https://cdn.parascene.com";
const IMAGE_EXTENSIONS = new Set([".avif", ".bmp", ".gif", ".heic", ".heif", ".jpeg", ".jpg", ".jxl", ".png", ".svg", ".tif", ".tiff", ".webp"]);
const TRANSCODE_EXTENSIONS = new Set([".heic", ".heif", ".jxl", ".tif", ".tiff"]);

function safeHeaderFilename(value, fallback) {
	const name = String(value || "").trim();
	return name && name.length <= 255 && !name.includes("/") && !name.includes("\\") && !/[\0-\x1f\x7f]/.test(name) ? name : fallback;
}

function safeSegment(value) {
	return String(value || "").replace(/[^a-z0-9._-]/gi, "_").replace(/_+/g, "_").slice(0, 80);
}

function uploadKind(req) {
	const value = String(req.get("x-upload-kind") || "generic").toLowerCase().trim();
	return ["edited", "generic", "avatar", "cover", "misc"].includes(value) ? value : "generic";
}

function contentType(req, filename) {
	const provided = String(req.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
	if (provided && provided !== "application/octet-stream") return provided;
	return contentTypeForFile({ name: filename });
}

function isImage(filename, type) {
	return String(type).startsWith("image/") || IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function extFor(filename, type, fallback) {
	const fromName = path.extname(filename).toLowerCase();
	if (/^\.[a-z0-9]{1,10}$/.test(fromName)) return fromName;
	const known = Object.entries({ "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg", "image/png": ".png", "video/mp4": ".mp4", "video/webm": ".webm", "audio/ogg": ".ogg", "application/pdf": ".pdf", "text/plain": ".txt" }).find(([mime]) => type.startsWith(mime));
	return known?.[1] || fallback;
}

function generatedKey(userId, kind, filename, type) {
	const now = Date.now();
	const random = crypto.randomBytes(5).toString("base64url");
	const user = safeSegment(userId);
	if (kind === "edited") return `edited/${user}/${now}_${random}.png`;
	const prefix = kind === "misc" ? "misc" : kind;
	return `profile/${user}/${prefix}_${now}_${random}${extFor(filename, type, kind === "misc" ? ".bin" : ".png")}`;
}

function needsBrowserSafeTranscode(filename, type) {
	const ext = path.extname(filename).toLowerCase();
	return TRANSCODE_EXTENSIONS.has(ext) || ["image/heic", "image/heif", "image/tiff", "image/tif", "image/jxl"].some((value) => type === value || type.startsWith(`${value};`));
}

function parseAspectRatio(value) {
	const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
	const width = Number(match?.[1]);
	const height = Number(match?.[2]);
	return width > 0 && height > 0 ? { width, height } : null;
}

async function normalizeEditedBuffer(buffer, aspectRatio) {
	const parsed = parseAspectRatio(aspectRatio);
	if (!parsed) {
		return sharp(buffer).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
	}
	const scale = 1024 / Math.max(parsed.width, parsed.height);
	const width = Math.max(1, Math.round(parsed.width * scale));
	const height = Math.max(1, Math.round(parsed.height * scale));
	return sharp(buffer).resize(width, height, { fit: "contain", background: { r: 24, g: 24, b: 32, alpha: 1 } }).png().toBuffer();
}

function publicUrl(key) {
	const origin = String(process.env.FILES_ORIGIN || DEFAULT_CDN_ORIGIN).replace(/\/$/, "");
	return `${origin}/api/images/generic/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function isOwnedKey(key, userId) {
	const id = String(Number(userId));
	return key.startsWith(`profile/${id}/`) || key.startsWith(`edited/${id}/`);
}

function setResponseHeaders(res, upstream, key, contentType) {
	for (const name of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
		const value = upstream.headers.get(name);
		if (value) res.set(name, value);
	}
	res.set("Content-Type", contentType || upstream.headers.get("content-type") || "application/octet-stream");
	res.set("X-Content-Type-Options", "nosniff");
	res.set("Content-Disposition", `${mayDisplayInline(contentType) ? "inline" : "attachment"}; filename="${path.basename(key).replace(/["\\\r\n]/g, "_")}"`);
}

export function createGenericRoutes(genericFiles, users) {
	const router = express.Router();

	router.post("/", requireAuth, async (req, res, next) => {
		const filename = safeHeaderFilename(req.get("x-upload-name"), "upload.bin");
		const type = contentType(req, filename);
		let kind = uploadKind(req);
		const image = isImage(filename, type);
		if (kind === "generic" && !image) kind = "misc";
		if (kind === "misc") {
			const user = await users.byId(req.auth.userId);
			const role = String(user?.role || "").toLowerCase();
			const plan = String(user?.meta?.plan || "").toLowerCase();
			if (role !== "admin" && role !== "founder" && plan !== "founder") {
				return res.status(403).json({ error: "Forbidden", message: "Only founder-level or admin accounts can upload non-image files." });
			}
		}
		const declaredBytes = Number(req.get("content-length"));
		if (Number.isFinite(declaredBytes) && declaredBytes > MAX_UPLOAD_BYTES) return res.status(413).json({ error: "File too large", max_bytes: MAX_UPLOAD_BYTES });
		const upload = createSizeLimitedStream(req);
		let key = null;
		try {
			const chunks = [];
			for await (const chunk of upload.stream) chunks.push(chunk);
			let body = Buffer.concat(chunks);
			let outputType = type;
			if (kind === "edited") {
				body = await normalizeEditedBuffer(body, req.get("x-upload-aspect-ratio"));
				outputType = "image/png";
			} else if (kind === "generic" && needsBrowserSafeTranscode(filename, type)) {
				try {
					body = await sharp(body).rotate().resize(4096, 4096, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
					outputType = "image/webp";
				} catch {
					kind = "misc";
					outputType = type || "application/octet-stream";
				}
			}
			key = generatedKey(req.auth.userId, kind, filename, type);
			await genericFiles.upload(key, body, { contentType: outputType, originalName: filename });
			return res.json({ ok: true, key, max_bytes: MAX_UPLOAD_BYTES, url: publicUrl(key), ...(kind === "misc" ? { display_as_file: true } : {}) });
		} catch (error) {
			await genericFiles.remove(key).catch(() => undefined);
			if (upload.exceeded) return res.status(413).json({ error: "File too large", max_bytes: MAX_UPLOAD_BYTES });
			return next(error);
		}
	});

	async function send(req, res, next) {
		const key = String(req.params.key || "");
		if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) return res.status(400).json({ error: "Invalid key" });
		const publicRead = key.startsWith("profile/") || key.startsWith("edited/");
		if (!publicRead && !req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
		const controller = new AbortController();
		res.on("close", () => { if (!res.writableEnded) controller.abort(); });
		try {
			const upstream = await genericFiles.fetch(key, { method: req.method, range: req.get("range"), signal: controller.signal });
			if (!upstream.ok) return res.status(upstream.status === 404 ? 404 : 502).json({ error: "Image not found" });
			const type = contentTypeForFile({ name: key });
			res.status(upstream.status);
			setResponseHeaders(res, upstream, key, type);
			res.set("Cache-Control", publicRead ? "public, max-age=3600" : "private, no-store");
			if (req.method === "HEAD" || !upstream.body) return res.end();
			return Readable.fromWeb(upstream.body).on("error", (error) => res.destroy(error)).pipe(res);
		} catch (error) {
			if (error?.name === "AbortError") return undefined;
			return next(error);
		}
	}

	router.get("/:key(*)", send);
	router.head("/:key(*)", send);
	router.delete("/:key(*)", requireAuth, async (req, res, next) => {
		const key = String(req.params.key || "");
		if (!isOwnedKey(key, req.auth.userId)) return res.status(403).json({ error: "Forbidden" });
		try {
			await genericFiles.remove(key);
			return res.json({ ok: true });
		} catch (error) { return next(error); }
	});

	return router;
}
