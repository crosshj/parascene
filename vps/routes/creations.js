import express from "express";
import { Readable } from "node:stream";
import path from "node:path";
import sharp from "sharp";
import { requireAuth } from "./middleware/auth.js";
import { creationAudioCdnId, creationMediaKey, creationVideoMediaKey } from "../db/creations.js";
import { extractVideoThumbnail } from "./utils/media.js";

function integer(value, fallback, min, max) {
	const n = Number.parseInt(String(value ?? ""), 10);
	return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function mediaType(row) {
	let meta = row?.meta;
	if (typeof meta === "string") {
		try { meta = JSON.parse(meta); } catch { meta = null; }
	}
	if (!meta || typeof meta !== "object") meta = {};
	const value = typeof meta.media_type === "string" ? meta.media_type.trim().toLowerCase() : "";
	if (value === "video" || creationVideoMediaKey({ meta })) return "video";
	if (value === "audio" || creationAudioCdnId({ meta })) return "audio";
	return value || "image";
}

function parseMeta(value) {
	if (typeof value === "string") {
		try { value = JSON.parse(value); } catch { value = null; }
	}
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function hasSunoImport(row) {
	const provider = parseMeta(row?.meta)?.import?.provider;
	return typeof provider === "string" && provider.trim().toLowerCase() === "suno";
}

function isAudioMediaKey(key) {
	return typeof key === "string" && /\.(mp3|wav|flac|ogg|oga|aac|m4a|mp4|webm)$/i.test(key);
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
	// A video's still-image row is often a transparent placeholder. Never expose
	// that still as video_url; only a real video object may be used for playback
	// or first-frame poster extraction.
	const videoKey = creationVideoMediaKey(row);
	const imageUrl = mediaUrl(row.id, key);
	const type = mediaType(row);
	const audioCdnId = creationAudioCdnId(row);
	return {
		id: row.id,
		user_id: row.user_id,
		filename: row.filename,
		file_path: row.file_path,
		url: imageUrl,
		thumbnail_url: mediaUrl(row.id, key, "thumbnail"),
		fit_thumbnail_url: mediaUrl(row.id, key, "fit"),
		video_thumbnail_url: type === "video" && videoKey ? mediaUrl(row.id, videoKey, "video_thumbnail") : null,
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
		video_url: type === "video" && videoKey ? mediaUrl(row.id, videoKey) : null,
		audio_url: type !== "audio"
			? null
			: audioCdnId
				? `/api/creations/${row.id}/audio`
				: !hasSunoImport(row) && isAudioMediaKey(key)
					? imageUrl
					: null
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

function blurredThumbnail(input) {
	let image = sharp(input, { failOn: "none" }).rotate();
	// Match the card crop on the server so the browser only composites a bitmap.
	return image.resize(480, 480, { fit: "cover", position: "centre" }).blur(60).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

function gridThumbnail(input) {
	return sharp(input, { failOn: "none" })
		.rotate()
		.resize(480, 480, { fit: "cover", position: "centre" })
		.jpeg({ quality: 82, mozjpeg: true })
		.toBuffer();
}

export function createCreationsRoutes({ creations, users }) {
	const router = express.Router();
	async function sendMedia(req, res, next) {
		const key = creations.safeKey(req.params[0]);
		if (!key) return res.status(400).json({ error: "Invalid media key" });
		try {
			const viewer = await users.byId(req.auth.userId);
			if (!(await creations.canAccessMedia(req.auth.userId, req.query.creation_id, key, { isAdmin: viewer?.role === "admin" }))) return res.status(404).json({ error: "Media not found" });
			const variant = String(req.query.variant || "").trim().toLowerCase();
			if (variant === "grid_thumbnail") {
				const response = await creations.fetchMedia(key, { method: "GET" });
				if (!response.ok || !response.body) return res.status(404).json({ error: "Media not found" });
				const chunks = [];
				for await (const chunk of Readable.fromWeb(response.body)) chunks.push(chunk);
				const output = await gridThumbnail(Buffer.concat(chunks));
				res.status(200);
				res.type("jpg");
				res.set("Content-Length", String(output.length));
				res.set("Content-Disposition", `inline; filename="${path.basename(key).replace(/["\\\r\n]/g, "_")}.jpg"`);
				res.set("X-Content-Type-Options", "nosniff");
				res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=86400");
				res.set("Cloudflare-CDN-Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
				return req.method === "HEAD" ? res.end() : res.send(output);
			}
			if (variant === "blur") {
				const sourceVariant = req.query.source_variant === "fit" ? "fit" : "thumbnail";
				const response = await creations.fetchMedia(key, { variant: sourceVariant, method: "GET" });
				if (!response.ok || !response.body) return res.status(404).json({ error: "Media not found" });
				const chunks = [];
				for await (const chunk of Readable.fromWeb(response.body)) chunks.push(chunk);
				const output = await blurredThumbnail(Buffer.concat(chunks));
				res.status(200);
				res.type("jpg");
				res.set("Content-Length", String(output.length));
				res.set("Content-Disposition", `inline; filename="${path.basename(key).replace(/["\\\r\n]/g, "_")}.jpg"`);
				res.set("X-Content-Type-Options", "nosniff");
				res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=86400");
				res.set("Cloudflare-CDN-Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
				return req.method === "HEAD" ? res.end() : res.send(output);
			}
			if (variant === "video_thumbnail") {
				const response = await creations.fetchMedia(key, { method: "GET" });
				if (!response.ok || !response.body) return res.status(404).json({ error: "Video not found" });
				const chunks = [];
				for await (const chunk of Readable.fromWeb(response.body)) chunks.push(chunk);
				const poster = await extractVideoThumbnail(Buffer.concat(chunks));
				if (!poster) return res.status(404).json({ error: "Video thumbnail unavailable" });
				res.status(200);
				res.type("jpg");
				res.set("Content-Length", String(poster.length));
				res.set("Content-Disposition", `inline; filename="${path.basename(key).replace(/["\\\r\n]/g, "_")}.jpg"`);
				res.set("X-Content-Type-Options", "nosniff");
				res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=86400");
				res.set("Cloudflare-CDN-Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
				return req.method === "HEAD" ? res.end() : res.send(poster);
			}
			const response = await creations.fetchMedia(key, { variant: req.query.variant, method: req.method, range: req.get("range") });
			if (!response.ok && response.status !== 416) {
				return res.status(response.status === 404 ? 404 : 502).json({ error: "Media not found" });
			}
			// Preserve 206 for Range requests; returning partial bytes as 200 makes
			// browsers treat the chunk as a complete video and breaks seeking/playback.
			res.status(response.status);
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
			const user = await users.byId(req.auth.userId);
			const viewerEnableNsfw = user?.meta?.enableNsfw === true;
			if (typeof req.query.ids === "string") {
				const ids = req.query.ids.split(",").map((value) => integer(value, 0, 0, Number.MAX_SAFE_INTEGER));
				const rows = await creations.listByIds(req.auth.userId, ids);
				res.set("Cache-Control", "private, no-store");
				return res.json({ creations: rows.map(serializeCreation), has_more: false });
			}
			const limit = integer(req.query.limit, 50, 1, 100);
			const offset = integer(req.query.offset, 0, 0, 100000);
			const challengeOnly = req.query.challenge_only === "1" || req.query.challenge_only === "true";
			const page = await creations.list(req.auth.userId, { limit, offset, challengeOnly, viewerEnableNsfw });
			res.set("Cache-Control", "private, no-store");
			return res.json({ creations: page.rows.map(serializeCreation), has_more: page.hasMore, limit, offset });
		} catch (error) { return next(error); }
	});

	router.get("/api/creations/:id", requireAuth, async (req, res, next) => {
		try {
			const viewer = await users.byId(req.auth.userId);
			const row = await creations.byIdForViewer(req.auth.userId, req.params.id, {
				isAdmin: viewer?.role === "admin"
			});
			if (!row) return res.status(404).json({ error: "Creation not found" });
			const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
			if (meta.nsfw === true && viewer?.meta?.enableNsfw !== true && Number(row.user_id) !== Number(req.auth.userId) && viewer?.role !== "admin") {
				return res.status(404).json({ error: "Creation not found" });
			}
			const creatorUser = Number(row.user_id) === Number(viewer?.id) ? viewer : await users.byId(row.user_id);
			const creatorProfile = await users.profileByUserId(row.user_id);
			const creation = serializeCreation(row);
			return res.json({
				...creation,
				like_count: 0,
				viewer_liked: false,
				liked_by: [],
				comment_count: 0,
				lineage_descendants: [],
				feed_pin: { active: false, until: null, challenge_id: null, pins: [] },
				challenge_organizer: { active: false, refs: [] },
				creator: creatorUser ? {
					id: creatorUser.id,
					email: creatorUser.email,
					role: creatorUser.role,
					user_name: creatorProfile?.user_name ?? null,
					display_name: creatorProfile?.display_name ?? null,
					avatar_url: creatorProfile?.avatar_url ?? null,
					plan: creatorUser.meta?.plan === "founder" ? "founder" : "free"
				} : null
			});
		} catch (error) { return next(error); }
	});

	router.get("/api/creations/:id/audio", requireAuth, async (req, res, next) => {
		try {
			const viewer = await users.byId(req.auth.userId);
			const row = await creations.byIdForViewer(req.auth.userId, req.params.id, { isAdmin: viewer?.role === "admin" });
			if (!row) return res.status(404).json({ error: "Audio not found" });
			const meta = parseMeta(row.meta);
			if (meta.nsfw === true && viewer?.meta?.enableNsfw !== true && Number(row.user_id) !== Number(req.auth.userId) && viewer?.role !== "admin") {
				return res.status(404).json({ error: "Audio not found" });
			}
			const cdnId = creationAudioCdnId(row);
			if (!cdnId || mediaType(row) !== "audio") return res.status(404).json({ error: "Audio not found" });
			const target = await creations.mintAudioPlaybackUrl(cdnId);
			res.set("Cache-Control", "private, no-store");
			return res.redirect(302, target);
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
