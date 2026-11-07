import express from "express";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { mintShareToken, verifyShareToken } from "./utils/shareLink.js";
import { resolveCreatedImageStorageFilename } from "./utils/resolveCreatedImageStorageFilename.js";
import { getBaseAppUrl, getShareBaseUrl } from "../services/create/url.js";

const PAGE_PATH = fileURLToPath(new URL("../pages/share/index.html", import.meta.url));
const ASSET_VERSION = encodeURIComponent(process.env.ASSET_VERSION || "share-v1");

function escapeHtml(value) {
	return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function parseMeta(value) {
	if (value && typeof value === "object") return value;
	if (typeof value === "string") { try { return JSON.parse(value) || {}; } catch {} }
	return {};
}

function requestOrigin(req) {
	return `${req.protocol}://${req.get("host")}`;
}

function rangeResponse(req, res, buffer, contentType) {
	const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.get("range") || "").trim());
	res.set("Accept-Ranges", "bytes").set("Cache-Control", "public, max-age=3600").type(contentType);
	if (range) {
		const start = Number(range[1]);
		const end = Math.min(range[2] ? Number(range[2]) : buffer.length - 1, buffer.length - 1);
		if (start >= buffer.length || start > end) return res.status(416).set("Content-Range", `bytes */${buffer.length}`).end();
		const part = buffer.subarray(start, end + 1);
		return res.status(206).set("Content-Range", `bytes ${start}-${end}/${buffer.length}`).set("Content-Length", String(part.length)).send(part);
	}
	return res.set("Content-Length", String(buffer.length)).send(buffer);
}

function verified(req) {
	const result = verifyShareToken(req.params);
	return result.ok ? result : null;
}

function tokenMediaPath(version, token, kind, origin) {
	return `${origin}/api/share/${encodeURIComponent(version)}/${encodeURIComponent(token)}/${kind}`;
}

function replaceTokens(html, values) {
	return html.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => String(values[key] ?? ""));
}

function personName(profile, user, fallback) {
	const username = String(profile?.user_name || "").trim();
	const emailPrefix = String(user?.email || "").split("@")[0];
	return {
		name: String(profile?.display_name || username || emailPrefix || fallback).trim(),
		handle: username ? `@${username}` : emailPrefix ? `@${emailPrefix}` : "",
		avatar: String(profile?.avatar_url || "").trim()
	};
}

function avatarMarkup(person, initial) {
	return person.avatar
		? `<img class="share-avatar-img" src="${escapeHtml(person.avatar)}" alt="" />`
		: `<span class="share-avatar-fallback" aria-hidden="true">${escapeHtml((person.name || initial).slice(0, 1).toUpperCase())}</span>`;
}

function sharePageHtml(template, req, image, verified, people, storage) {
	const { version, token, bust = "" } = req.params;
	const pageOrigin = requestOrigin(req);
	const canonical = `${getShareBaseUrl()}${req.originalUrl}`;
	const imagePath = tokenMediaPath(version, token, "image", pageOrigin);
	const imageUrl = `${imagePath}?variant=wide&v=${encodeURIComponent(bust || token)}`;
	const titleRaw = String(image.title || "").trim();
	const title = titleRaw ? `Parascene — ${titleRaw}` : `Parascene — Creation #${image.id}`;
	const sharer = people.sharer;
	const creator = people.creator;
	const showCreator = Number(verified.sharedByUserId) !== Number(image.user_id);
	const description = String(image.description || "").trim().slice(0, 400);
	const meta = parseMeta(image.meta);
	const mediaType = meta.media_type || image.media_type;
	const isVideo = mediaType === "video" && meta.video;
	const mediaHtml = isVideo
		? `<div class="share-hero-video-wrap"><video class="share-image share-video" data-share-hero-video playsinline muted loop preload="metadata" poster="${escapeHtml(imagePath)}" src="${escapeHtml(tokenMediaPath(version, token, "video", pageOrigin))}" aria-label="${escapeHtml(titleRaw || "Parascene creation")}"></video><button type="button" class="share-video-play-btn" data-share-video-play aria-label="Play video"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg></button></div>`
		: buildImageHero(image, meta, imagePath, titleRaw, version, token, pageOrigin, storage, verified.sharedByUserId);
	const creatorHtml = showCreator ? `<div class="share-person"><div class="share-avatar">${avatarMarkup(creator, "C")}</div><div class="share-person-text"><div class="share-person-label">Created by</div><div class="share-person-name">${escapeHtml(creator.handle || creator.name)}</div></div></div>` : "";
	const intro = showCreator
		? `${escapeHtml(sharer.handle || sharer.name)} shared this with you. It was created by ${escapeHtml(creator.handle || creator.name)} on Parascene.`
		: `${escapeHtml(sharer.handle || sharer.name)} shared this creation with you — they made it on Parascene.`;
	const isLoggedIn = Boolean(req.auth?.userId);
	const requestPath = req.originalUrl || req.path;
	const values = {
		PAGE_TITLE: escapeHtml(title), PAGE_DESCRIPTION: escapeHtml(description || "A creation shared on Parascene."),
		REQUEST_URL: escapeHtml(canonical), OG_IMAGE_URL: escapeHtml(imageUrl), OG_IMAGE_SECURE_URL: escapeHtml(imageUrl),
		OG_IMAGE_DIMS_META: `<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="675" />`,
		IMAGE_ALT: escapeHtml(titleRaw || "Parascene creation"), SHARE_IMAGE_SRC: escapeHtml(imagePath),
		SHARE_HERO_MEDIA_HTML: mediaHtml,
		SHARE_DETAILS_TITLE_HTML: titleRaw ? `<h2 class="share-details-title">${escapeHtml(titleRaw)}</h2>` : "",
		IMAGE_DESCRIPTION_HTML: description ? `<p class="share-image-description">${escapeHtml(description)}</p>` : "",
		SHARER_AVATAR_HTML: avatarMarkup(sharer, "S"), SHARER_NAME: escapeHtml(sharer.handle || sharer.name),
		CREATOR_BLOCK_HTML: creatorHtml, SHARE_INTRO_HTML: intro,
		SIGNIN_URL: `/auth?returnUrl=${encodeURIComponent(requestPath)}#login`,
		REFERRER_USER_ID: String(Number(verified.sharedByUserId) || 0), IMAGE_ID: String(image.id),
		CREATED_BY_USER_ID: String(Number(image.user_id) || 0), CREATION_DETAIL_URL: `${getBaseAppUrl()}/creations/${image.id}`,
		SHARE_VIEW_LINK_ATTR: isLoggedIn ? "" : " hidden", SHARE_CREATE_BLOCK_ATTR: isLoggedIn ? " hidden" : "",
		V: `?v=${ASSET_VERSION}`
	};
	return replaceTokens(template, values);
}

function buildImageHero(image, meta, imagePath, title, version, token, origin, storage, sharedByUserId) {
	const group = meta?.group;
	let sourceRows = [];
	if (group?.kind === "group_creations" && Array.isArray(group.source_creations)) {
		sourceRows = group.source_creations.filter((source) => source && typeof source === "object");
		const coverId = Number(group.cover_source_id);
		const coverIndex = sourceRows.findIndex((source) => Number(source.id) === coverId);
		if (coverIndex > 0) sourceRows.unshift(...sourceRows.splice(coverIndex, 1));
	}
	const slides = [];
	for (const source of sourceRows) {
		let media = String(source?.file_path || "").trim();
		if (!media && source?.filename && storage?.getImageUrl) media = storage.getImageUrl(source.filename);
		const sourceId = Number(source?.id);
		if (!media || !Number.isInteger(sourceId) || sourceId <= 0) continue;
		const sourceToken = mintShareToken({ version, imageId: sourceId, sharedByUserId });
		slides.push({
			url: tokenMediaPath(version, sourceToken, "image", origin),
			title: source.title || title || "Parascene creation"
		});
	}
	const layout = image.width > 0 && image.height > 0
		? ` style="--hero-aspect-w:${Number(image.width)};--hero-aspect-h:${Number(image.height)};--hero-aspect-ratio:${Number(image.width)} / ${Number(image.height)}"`
		: "";
	const data = slides.length > 1 ? ` share-hero-media-wrap--group" data-share-group-carousel-b64="${Buffer.from(JSON.stringify(slides)).toString("base64")}` : "";
	const nav = slides.length > 1
		? '<button type="button" class="share-hero-nav share-hero-nav-prev" data-share-group-prev hidden aria-label="Previous image"><svg viewBox="0 0 24 24"><path d="M14.5 6.5L9 12l5.5 5.5" /></svg></button><button type="button" class="share-hero-nav share-hero-nav-next" data-share-group-next hidden aria-label="Next image"><svg viewBox="0 0 24 24"><path d="M9.5 6.5L15 12l-5.5 5.5" /></svg></button>'
		: "";
	return `<div class="share-hero-media-wrap hero-layout-legacy${data}"${layout}><img class="share-image" data-share-hero-cover src="${escapeHtml(imagePath)}" alt="${escapeHtml(title || "Parascene creation")}" decoding="async" />${nav}</div>`;
}

export default function createShareRoutes({ queries, storage }) {
	const router = express.Router();
	let templatePromise;
	const getTemplate = () => templatePromise ||= fs.readFile(PAGE_PATH, "utf8");

	router.get("/s/:version/:token/:bust?", async (req, res, next) => {
		const proof = verified(req);
		if (!proof) return res.status(404).type("html").send("Share link unavailable");
		try {
			const image = await queries.selectCreatedImageByIdAnyUser?.get(proof.imageId);
			if (!image || (image.status || "completed") !== "completed" || image.unavailable_at) return res.status(404).type("html").send("Share link unavailable");
			const [sharerProfile, sharerUser, creatorProfile, creatorUser] = await Promise.all([
				queries.selectUserProfileByUserId?.get(proof.sharedByUserId).catch(() => null),
				queries.selectUserById?.get(proof.sharedByUserId).catch(() => null),
				queries.selectUserProfileByUserId?.get(image.user_id).catch(() => null),
				queries.selectUserById?.get(image.user_id).catch(() => null)
			]);
			void queries.insertSharePageView?.run?.(
				proof.sharedByUserId, image.id, image.user_id,
				typeof req.get("referer") === "string" ? req.get("referer").trim() : null,
				typeof req.cookies?.ps_cid === "string" ? req.cookies.ps_cid : null,
				{ page: "share", user_agent: req.get("user-agent") || null, ip: req.ip || null }
			).catch?.(() => {});
			const html = sharePageHtml(await getTemplate(), req, image, proof, {
				sharer: personName(sharerProfile, sharerUser, "your friend"),
				creator: personName(creatorProfile, creatorUser, "the creator")
			}, storage);
			res.set("Cache-Control", "public, max-age=60").vary("Cookie").type("html").send(html);
		} catch (error) { next(error); }
	});

	router.get("/api/share/:version/:token/image", async (req, res) => {
		const proof = verified(req);
		if (!proof) return res.status(404).json({ error: "Not found" });
		try {
			const image = await queries.selectCreatedImageByIdAnyUser?.get(proof.imageId);
			const filename = resolveCreatedImageStorageFilename(image);
			if (!image || (image.status || "completed") !== "completed" || !filename) return res.status(404).json({ error: "Not found" });
			let buffer = await storage.getImageBuffer(filename);
			if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) buffer = await sharp(buffer, { failOn: "none" }).png().toBuffer();
			if (["wide", "card"].includes(String(req.query.variant || "").toLowerCase())) {
				buffer = await sharp(buffer, { failOn: "none" }).resize(1200, 1200, { fit: "cover", position: "centre" }).extract({ left: 0, top: 262, width: 1200, height: 675 }).png().toBuffer();
			}
			return res.type("png").set("Cache-Control", req.query.v ? "public, max-age=31536000, immutable" : "public, max-age=3600").send(buffer);
		} catch { return res.status(500).json({ error: "Failed to serve image" }); }
	});

	router.get("/api/share/:version/:token/video", async (req, res) => {
		const proof = verified(req);
		if (!proof) return res.status(404).json({ error: "Not found" });
		try {
			const image = await queries.selectCreatedImageByIdAnyUser?.get(proof.imageId);
			const meta = parseMeta(image?.meta);
			const filename = typeof meta.video?.filename === "string" ? meta.video.filename : String(meta.video?.file_path || "").replace(/^\/api\/videos\/created\//, "");
			if (!image || (image.status || "completed") !== "completed" || meta.media_type !== "video" || !filename) return res.status(404).json({ error: "Not found" });
			return rangeResponse(req, res, await storage.getVideoBuffer(filename), meta.video.content_type || "video/mp4");
		} catch { return res.status(500).json({ error: "Failed to serve video" }); }
	});

	router.get("/api/share/:version/:token/audio", async (req, res) => {
		const proof = verified(req);
		if (!proof) return res.status(404).json({ error: "Not found" });
		try {
			const image = await queries.selectCreatedImageByIdAnyUser?.get(proof.imageId);
			const audio = parseMeta(image?.meta).share_audio;
			if (!image || (image.status || "completed") !== "completed" || !audio?.key) return res.status(404).json({ error: "Not found" });
			return rangeResponse(req, res, await storage.getGenericImageBuffer(audio.key), audio.content_type || "audio/webm");
		} catch { return res.status(500).json({ error: "Failed to serve audio" }); }
	});

	router.get("/api/share/:version/:token/clip-audio", async (req, res) => {
		const proof = verified(req);
		if (!proof) return res.status(404).json({ error: "Not found" });
		try {
			const clip = await queries.selectAudioClipById?.get(proof.imageId);
			if (!clip?.storage_key) return res.status(404).json({ error: "Not found" });
			return rangeResponse(req, res, await storage.getGenericImageBuffer(clip.storage_key), clip.content_type || "audio/webm");
		} catch { return res.status(500).json({ error: "Failed to serve audio" }); }
	});

	return router;
}
