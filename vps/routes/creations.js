import express from "express";
import { Readable } from "node:stream";
import path from "node:path";
import { requireAuth } from "./middleware/auth.js";
import { creationMediaKey } from "../db/creations.js";

function integer(value, fallback, min, max) {
	const n = Number.parseInt(String(value ?? ""), 10);
	return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function mediaType(row) {
	const value = row?.meta && typeof row.meta === "object" ? row.meta.media_type : null;
	return typeof value === "string" && value.trim() ? value.trim() : "image";
}

function isModeratedError(row) {
	if (String(row?.status || "") !== "failed") return false;
	const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
	const providerBody = meta.provider_error && typeof meta.provider_error === "object" ? meta.provider_error.body : "";
	const text = [meta.error, providerBody, providerBody?.error, providerBody?.message].filter((value) => typeof value === "string").join(" ").toLowerCase();
	return text.includes("moderated") || text.includes("flagged as sensitive");
}

function mediaUrl(id, key, variant = "") {
	if (!key) return null;
	const encoded = key.split("/").map(encodeURIComponent).join("/");
	const query = new URLSearchParams({ creation_id: String(id) });
	if (variant) query.set("variant", variant);
	return `/api/creations/media/${encoded}?${query}`;
}

function serializeCreation(row) {
	const key = creationMediaKey(row);
	const imageUrl = mediaUrl(row.id, key);
	const type = mediaType(row);
	return {
		id: row.id,
		filename: row.filename,
		file_path: row.file_path,
		url: imageUrl,
		thumbnail_url: mediaUrl(row.id, key, "thumbnail"),
		fit_thumbnail_url: mediaUrl(row.id, key, "fit"),
		width: row.width,
		height: row.height,
		color: row.color,
		status: row.status,
		created_at: row.created_at,
		published: row.published,
		published_at: row.published_at,
		title: row.title,
		description: row.description,
		meta: row.meta,
		nsfw: Boolean(row.meta && typeof row.meta === "object" && row.meta.nsfw),
		is_moderated_error: isModeratedError(row),
		media_type: type,
		video_url: type === "video" ? imageUrl : null,
		audio_url: type === "audio" ? imageUrl : null
	};
}

function setMediaHeaders(res, upstream, key) {
	for (const name of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
		const value = upstream.headers.get(name);
		if (value) res.set(name, value);
	}
	res.set("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
	res.set("Content-Disposition", `inline; filename="${path.basename(key).replace(/["\\\r\n]/g, "_")}"`);
}

export function createCreationsRoutes({ creations, users }) {
	const router = express.Router();
	async function sendMedia(req, res, next) {
		const key = creations.safeKey(req.params[0]);
		if (!key) return res.status(400).json({ error: "Invalid media key" });
		try {
			if (!(await creations.ownsMedia(req.auth.userId, req.query.creation_id, key))) return res.status(404).json({ error: "Media not found" });
			const response = await creations.fetchMedia(key, { variant: req.query.variant, method: req.method, range: req.get("range") });
			if (!response.ok) return res.status(response.status === 404 ? 404 : 502).json({ error: "Media not found" });
			setMediaHeaders(res, response, key);
			// Creation media is treated as shareable, non-sensitive content. Keep the
			// ownership check on origin misses, then let browsers and Cloudflare reuse
			// the successful representation. The URL contains the media key and variant,
			// so different media objects do not collide in the cache. Do not use
			// `immutable`: these URLs are stable, but are not formally content-addressed.
			res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=86400");
			res.set("Cloudflare-CDN-Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
			if (req.method === "HEAD" || !response.body) return res.end();
			return Readable.fromWeb(response.body).on("error", next).pipe(res);
		} catch (error) { return next(error); }
	}

	router.get("/api/creations", requireAuth, async (req, res, next) => {
		try {
			const limit = integer(req.query.limit, 50, 1, 100);
			const offset = integer(req.query.offset, 0, 0, 100000);
			const challengeOnly = req.query.challenge_only === "1" || req.query.challenge_only === "true";
			const user = await users.byId(req.auth.userId);
			const viewerEnableNsfw = user?.meta?.enableNsfw === true;
			const page = await creations.list(req.auth.userId, { limit, offset, challengeOnly, viewerEnableNsfw });
			res.set("Cache-Control", "private, no-store");
			return res.json({ creations: page.rows.map(serializeCreation), has_more: page.hasMore, limit, offset });
		} catch (error) { return next(error); }
	});

	router.get("/api/creations/media/*", requireAuth, sendMedia);
	// During migration, accept the established media path too. This serves the
	// media resource from VPS; it does not delegate to WWW.
	router.get("/api/images/created/*", requireAuth, sendMedia);
	router.head("/api/creations/media/*", requireAuth, sendMedia);
	router.head("/api/images/created/*", requireAuth, sendMedia);
	return router;
}
