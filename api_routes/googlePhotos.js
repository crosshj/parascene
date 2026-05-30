import crypto from "crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "./auth.js";
import { resolveCreationImageForExport } from "./utils/resolveCreationImageForExport.js";
import { getBaseAppUrl } from "./utils/url.js";

const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const PHOTOS_UPLOAD_URL = "https://photoslibrary.googleapis.com/v1/uploads";
const PHOTOS_ALBUMS_URL = "https://photoslibrary.googleapis.com/v1/albums";
const PHOTOS_BATCH_CREATE_URL = "https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate";
const PHOTOS_MEDIA_SEARCH_URL = "https://photoslibrary.googleapis.com/v1/mediaItems:search";
const PHOTOS_ALBUM_REMOVE_URL = (albumId) =>
	`https://photoslibrary.googleapis.com/v1/albums/${encodeURIComponent(albumId)}:batchRemoveMediaItems`;
const MAX_ALBUM_TITLE_LEN = 80;

const DEFAULT_ALBUM_TITLE = "Parascene";
const STATE_TTL_SEC = 10 * 60;

function normalizeReturnUrl(raw) {
	const value = typeof raw === "string" ? raw.trim() : "";
	if (!value) return "/integrations";
	if (!value.startsWith("/")) return "/integrations";
	if (value.startsWith("//")) return "/integrations";
	if (value.includes("://")) return "/integrations";
	if (value.length > 2048) return "/integrations";
	if (value === "/auth" || value === "/auth.html") return "/integrations";
	return value;
}

function randomNonce() {
	return crypto.randomBytes(16).toString("base64url");
}

function buildState({ userId, returnUrl }) {
	const payload = {
		typ: "google_photos_state",
		uid: Number(userId) || 0,
		ru: normalizeReturnUrl(returnUrl),
		nonce: randomNonce()
	};
	return jwt.sign(payload, getJwtSecret(), { expiresIn: STATE_TTL_SEC, algorithm: "HS256" });
}

function parseState(token) {
	if (!token || typeof token !== "string") return null;
	try {
		const payload = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] });
		if (!payload || typeof payload !== "object") return null;
		if (payload.typ !== "google_photos_state") return null;
		const uid = Number(payload.uid);
		const ru = normalizeReturnUrl(payload.ru);
		if (!Number.isFinite(uid) || uid <= 0) return null;
		return { userId: uid, returnUrl: ru };
	} catch {
		return null;
	}
}

function tokenSecret() {
	return String(process.env.GOOGLE_PHOTOS_TOKEN_SECRET || process.env.SESSION_SECRET || "dev-secret-change-me");
}

function encryptWithSecret(plainText, secret) {
	const sec = String(secret || "");
	if (!sec) return null;
	try {
		const iv = crypto.randomBytes(12);
		const key = crypto.createHash("sha256").update(sec).digest();
		const enc = crypto.createCipheriv("aes-256-gcm", key, iv);
		const ciphertext = Buffer.concat([enc.update(String(plainText || ""), "utf8"), enc.final()]);
		const tag = enc.getAuthTag();
		const payload = Buffer.concat([ciphertext, tag]);
		return `${iv.toString("base64url")}.${payload.toString("base64url")}`;
	} catch {
		return null;
	}
}

function decryptWithSecret(token, secret) {
	const parts = String(token || "").split(".");
	if (parts.length !== 2) return null;
	const sec = String(secret || "");
	if (!sec) return null;
	try {
		const iv = Buffer.from(parts[0], "base64url");
		const ctAndTag = Buffer.from(parts[1], "base64url");
		if (iv.length !== 12 || ctAndTag.length <= 16) return null;
		const key = crypto.createHash("sha256").update(sec).digest();
		const tag = ctAndTag.subarray(ctAndTag.length - 16);
		const ciphertext = ctAndTag.subarray(0, ctAndTag.length - 16);
		const dec = crypto.createDecipheriv("aes-256-gcm", key, iv);
		dec.setAuthTag(tag);
		return Buffer.concat([dec.update(ciphertext), dec.final()]).toString("utf8") || null;
	} catch {
		return null;
	}
}

function requiredEnv(name) {
	const v = String(process.env[name] || "").trim();
	return v ? v : null;
}

function buildScopes() {
	return [
		"https://www.googleapis.com/auth/photoslibrary.appendonly",
		"https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata",
		"https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata"
	].join(" ");
}

function parseMeta(raw) {
	if (raw == null) return {};
	if (typeof raw === "object") return raw;
	if (typeof raw === "string" && raw.trim()) {
		try {
			return JSON.parse(raw);
		} catch {
			return {};
		}
	}
	return {};
}

function parseCreationIdFromPartyMedia(item) {
	const filename = typeof item?.filename === "string" ? item.filename : "";
	const fromName = filename.match(/^parascene-(\d+)\./i);
	if (fromName) {
		const id = Number(fromName[1]);
		if (Number.isFinite(id) && id > 0) return id;
	}
	const description = typeof item?.description === "string" ? item.description : "";
	const fromDesc = description.match(/creation\s+(\d+)/i);
	if (fromDesc) {
		const id = Number(fromDesc[1]);
		if (Number.isFinite(id) && id > 0) return id;
	}
	return null;
}

function partyMediaDescription(creationId) {
	return `Parascene creation ${Number(creationId)}`;
}

function normalizeAlbumTitle(raw) {
	const title = typeof raw === "string" ? raw.trim() : "";
	if (!title) return "";
	return title.slice(0, MAX_ALBUM_TITLE_LEN);
}

async function fetchJson(url, options = {}) {
	const res = await fetch(url, options);
	const text = await res.text().catch(() => "");
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = null;
	}
	return { ok: res.ok, status: res.status, data, text };
}

async function exchangeCodeForTokens({ code, redirectUri, clientId, clientSecret }) {
	const body = new URLSearchParams();
	body.set("code", String(code || ""));
	body.set("client_id", clientId);
	body.set("client_secret", clientSecret);
	body.set("redirect_uri", redirectUri);
	body.set("grant_type", "authorization_code");

	const { ok, data, text } = await fetchJson(GOOGLE_OAUTH_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body
	});
	if (!ok) {
		const msg = data?.error_description || data?.error || text || "Token exchange failed";
		throw new Error(String(msg));
	}
	return {
		access_token: typeof data?.access_token === "string" ? data.access_token : "",
		refresh_token: typeof data?.refresh_token === "string" ? data.refresh_token : "",
		scope: typeof data?.scope === "string" ? data.scope : "",
		expires_in: typeof data?.expires_in === "number" ? data.expires_in : null,
		token_type: typeof data?.token_type === "string" ? data.token_type : ""
	};
}

async function refreshAccessToken({ refreshToken, clientId, clientSecret }) {
	const body = new URLSearchParams();
	body.set("client_id", clientId);
	body.set("client_secret", clientSecret);
	body.set("refresh_token", String(refreshToken || ""));
	body.set("grant_type", "refresh_token");

	const { ok, data, text } = await fetchJson(GOOGLE_OAUTH_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body
	});
	if (!ok) {
		const msg = data?.error_description || data?.error || text || "Refresh failed";
		throw new Error(String(msg));
	}
	return {
		access_token: typeof data?.access_token === "string" ? data.access_token : "",
		scope: typeof data?.scope === "string" ? data.scope : "",
		expires_in: typeof data?.expires_in === "number" ? data.expires_in : null,
		token_type: typeof data?.token_type === "string" ? data.token_type : ""
	};
}

async function createAlbum({ accessToken, title }) {
	const albumTitle = normalizeAlbumTitle(title) || DEFAULT_ALBUM_TITLE;
	const { ok, data, text } = await fetchJson(PHOTOS_ALBUMS_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ album: { title: albumTitle } })
	});
	if (!ok) {
		const msg = data?.error?.message || text || "Album create failed";
		throw new Error(String(msg));
	}
	const id = typeof data?.id === "string" ? data.id : "";
	if (!id) throw new Error("Album create failed");
	return { albumId: id, albumTitle };
}

async function createDefaultAlbum({ accessToken }) {
	return createAlbum({ accessToken, title: DEFAULT_ALBUM_TITLE });
}

async function listAppCreatedAlbums({ accessToken }) {
	const albums = [];
	let pageToken = "";
	for (let page = 0; page < 20; page++) {
		const url = new URL(PHOTOS_ALBUMS_URL);
		url.searchParams.set("pageSize", "50");
		if (pageToken) url.searchParams.set("pageToken", pageToken);
		const { ok, data, text } = await fetchJson(url.toString(), {
			headers: { Authorization: `Bearer ${accessToken}` }
		});
		if (!ok) {
			const msg = data?.error?.message || text || "Album list failed";
			throw new Error(String(msg));
		}
		const batch = Array.isArray(data?.albums) ? data.albums : [];
		for (const album of batch) {
			const id = typeof album?.id === "string" ? album.id : "";
			const title = typeof album?.title === "string" ? album.title : "";
			if (id) albums.push({ albumId: id, albumTitle: title });
		}
		pageToken = typeof data?.nextPageToken === "string" ? data.nextPageToken : "";
		if (!pageToken) break;
	}
	return albums;
}

async function findOrCreateAlbumByTitle({ accessToken, title }) {
	const wanted = normalizeAlbumTitle(title);
	if (!wanted) return createDefaultAlbum({ accessToken });
	const albums = await listAppCreatedAlbums({ accessToken });
	const match = albums.find((row) => row.albumTitle === wanted);
	if (match) return match;
	return createAlbum({ accessToken, title: wanted });
}

async function uploadBytesToPhotos({ accessToken, bytes, filename }) {
	const res = await fetch(PHOTOS_UPLOAD_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/octet-stream",
			"X-Goog-Upload-Protocol": "raw",
			"X-Goog-Upload-File-Name": filename || "parascene.png"
		},
		body: bytes
	});
	const text = await res.text().catch(() => "");
	if (!res.ok) {
		throw new Error(text || "Upload bytes failed");
	}
	return text.trim();
}

async function batchCreateMediaItem({ accessToken, uploadToken, albumId, filename, description }) {
	const body = {
		albumId,
		newMediaItems: [
			{
				description: typeof description === "string" && description.trim()
					? description.trim()
					: "Uploaded from Parascene",
				simpleMediaItem: {
					fileName: filename || "parascene.png",
					uploadToken
				}
			}
		]
	};
	const { ok, data, text } = await fetchJson(PHOTOS_BATCH_CREATE_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify(body)
	});
	if (!ok) {
		const msg = data?.error?.message || text || "Create media item failed";
		throw new Error(String(msg));
	}
	const results = Array.isArray(data?.newMediaItemResults) ? data.newMediaItemResults : [];
	const r0 = results[0];
	const status = r0?.status;
	if (status && typeof status === "object" && status.code && Number(status.code) !== 0) {
		throw new Error(String(status.message || "Upload failed"));
	}
	const mediaItemId =
		typeof r0?.mediaItem?.id === "string" && r0.mediaItem.id.trim() ? r0.mediaItem.id.trim() : "";
	return { ok: true, mediaItemId };
}

async function batchRemoveMediaFromAlbum({ accessToken, albumId, mediaItemIds }) {
	const ids = (Array.isArray(mediaItemIds) ? mediaItemIds : [])
		.map((id) => (typeof id === "string" ? id.trim() : ""))
		.filter(Boolean);
	if (!ids.length) return { ok: true, removed: 0 };
	const album = typeof albumId === "string" ? albumId.trim() : "";
	if (!album) throw new Error("Invalid album id");
	const { ok, data, text } = await fetchJson(PHOTOS_ALBUM_REMOVE_URL(album), {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ mediaItemIds: ids })
	});
	if (!ok) {
		const msg = data?.error?.message || text || "Remove from album failed";
		throw new Error(String(msg));
	}
	return { ok: true, removed: ids.length };
}

async function searchAlbumMediaItems({ accessToken, albumId }) {
	const album = typeof albumId === "string" ? albumId.trim() : "";
	if (!album) return [];
	const items = [];
	let pageToken = "";
	for (let page = 0; page < 50; page++) {
		const body = { albumId: album, pageSize: 100 };
		if (pageToken) body.pageToken = pageToken;
		const { ok, data, text } = await fetchJson(PHOTOS_MEDIA_SEARCH_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body)
		});
		if (!ok) {
			const msg = data?.error?.message || text || "Album media list failed";
			throw new Error(String(msg));
		}
		const batch = Array.isArray(data?.mediaItems) ? data.mediaItems : [];
		for (const item of batch) {
			const id = typeof item?.id === "string" ? item.id.trim() : "";
			if (!id) continue;
			items.push({
				id,
				filename: typeof item?.filename === "string" ? item.filename : "",
				description: typeof item?.description === "string" ? item.description : ""
			});
		}
		pageToken = typeof data?.nextPageToken === "string" ? data.nextPageToken : "";
		if (!pageToken) break;
	}
	return items;
}

async function uploadPartyCreationToAlbum({
	accessToken,
	albumId,
	creationId,
	user,
	queries,
	storage
}) {
	const id = Number(creationId);
	const resolved = await resolveCreationImageForExport({ queries, creationId: id, user });
	if (!resolved.ok) {
		throw new Error(resolved.error || "Creation not available for export");
	}
	const bytes = await storage.getImageBuffer(resolved.image.filename);
	const filename = `parascene-${id}.png`;
	const uploadToken = await uploadBytesToPhotos({
		accessToken,
		bytes,
		filename
	});
	const created = await batchCreateMediaItem({
		accessToken,
		uploadToken,
		albumId,
		filename,
		description: partyMediaDescription(id)
	});
	return {
		mediaItemId: created.mediaItemId || null,
		filename
	};
}

async function getGooglePhotosAccessForUser(user, queries) {
	const clientId = requiredEnv("GOOGLE_PHOTOS_CLIENT_ID");
	const clientSecret = requiredEnv("GOOGLE_PHOTOS_CLIENT_SECRET");
	if (!clientId || !clientSecret) {
		throw new Error("Google Photos is not configured");
	}
	if (!queries.selectGooglePhotosConnectionByUserId?.get) {
		throw new Error("Google Photos storage is not configured");
	}
	const row = await queries.selectGooglePhotosConnectionByUserId.get(user.id);
	if (!row || row.revoked_at) {
		throw new Error("Not connected");
	}
	const refreshToken = decryptWithSecret(row.refresh_token_enc, tokenSecret());
	if (!refreshToken) {
		throw new Error("Not connected");
	}
	const access = await refreshAccessToken({ refreshToken, clientId, clientSecret });
	if (!access.access_token) {
		throw new Error("Could not authorize Google Photos");
	}
	return { accessToken: access.access_token, connection: row };
}

function getGroupSourceCreationIds(meta) {
	const groupPayload = meta?.group && typeof meta.group === "object" ? meta.group : null;
	const rawIds = Array.isArray(groupPayload?.source_creation_ids) ? groupPayload.source_creation_ids : [];
	return new Set(
		rawIds
			.map((id) => Number(id))
			.filter((id) => Number.isFinite(id) && id > 0)
	);
}

function filterPartyPushedToGroupSources(meta, pushedEntries) {
	const sourceIds = getGroupSourceCreationIds(meta);
	if (!sourceIds.size) return pushedEntries;
	return pushedEntries.filter((entry) => sourceIds.has(Number(entry.creation_id)));
}

function normalizePartyPushedEntries(raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	const seen = new Set();
	for (const entry of raw) {
		const creationId = Number(entry?.creation_id ?? entry?.creationId);
		if (!Number.isFinite(creationId) || creationId <= 0 || seen.has(creationId)) continue;
		seen.add(creationId);
		const pushedAt =
			typeof entry?.pushed_at === "string" && entry.pushed_at.trim()
				? entry.pushed_at.trim()
				: new Date().toISOString();
		const normalized = { creation_id: creationId, pushed_at: pushedAt };
		const mediaItemId =
			typeof entry?.google_photos_media_item_id === "string" ? entry.google_photos_media_item_id.trim() : "";
		const albumId =
			typeof entry?.google_photos_album_id === "string" ? entry.google_photos_album_id.trim() : "";
		if (mediaItemId) normalized.google_photos_media_item_id = mediaItemId;
		if (albumId) normalized.google_photos_album_id = albumId;
		out.push(normalized);
	}
	return out;
}

export default function createGooglePhotosRoutes({ queries, storage }) {
	const router = express.Router();

	async function requireUser(req, res) {
		if (!req.auth?.userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}
		const user = await queries.selectUserById.get(req.auth.userId);
		if (!user) {
			res.status(404).json({ error: "User not found" });
			return null;
		}
		return user;
	}

	router.get("/api/google-photos/status", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		if (!queries.selectGooglePhotosConnectionByUserId?.get) {
			return res.json({ connected: false, configured: false });
		}
		const row = await queries.selectGooglePhotosConnectionByUserId.get(user.id);
		const connected = !!row && !row.revoked_at;
		return res.json({
			configured: true,
			connected,
			albumTitle: connected ? row.album_title || DEFAULT_ALBUM_TITLE : null
		});
	});

	router.get("/api/google-photos/connect", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const clientId = requiredEnv("GOOGLE_PHOTOS_CLIENT_ID");
		const clientSecret = requiredEnv("GOOGLE_PHOTOS_CLIENT_SECRET");
		if (!clientId || !clientSecret) {
			return res.status(500).json({ error: "Server error", message: "Google Photos is not configured" });
		}
		const redirectUri = `${getBaseAppUrl()}/api/google-photos/callback`;
		const returnUrl = normalizeReturnUrl(req.query?.returnUrl || "/integrations");
		const state = buildState({ userId: user.id, returnUrl });

		const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
		url.searchParams.set("client_id", clientId);
		url.searchParams.set("redirect_uri", redirectUri);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("scope", buildScopes());
		url.searchParams.set("access_type", "offline");
		url.searchParams.set("include_granted_scopes", "true");
		url.searchParams.set("prompt", "consent");
		url.searchParams.set("state", state);

		return res.redirect(302, url.toString());
	});

	router.get("/api/google-photos/callback", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const stateStr = typeof req.query?.state === "string" ? req.query.state : "";
		const parsedState = parseState(stateStr);
		const returnUrl = parsedState?.returnUrl || "/integrations";
		if (!parsedState || Number(parsedState.userId) !== Number(user.id)) {
			return res.redirect(302, `${returnUrl}#google-photos=state`);
		}

		const code = typeof req.query?.code === "string" ? req.query.code : "";
		const err = typeof req.query?.error === "string" ? req.query.error : "";
		if (err) {
			return res.redirect(302, `${returnUrl}#google-photos=deny`);
		}
		if (!code) {
			return res.redirect(302, `${returnUrl}#google-photos=code`);
		}

		const clientId = requiredEnv("GOOGLE_PHOTOS_CLIENT_ID");
		const clientSecret = requiredEnv("GOOGLE_PHOTOS_CLIENT_SECRET");
		if (!clientId || !clientSecret) {
			return res.redirect(302, `${returnUrl}#google-photos=config`);
		}
		const redirectUri = `${getBaseAppUrl()}/api/google-photos/callback`;

		try {
			const tok = await exchangeCodeForTokens({ code, redirectUri, clientId, clientSecret });
			if (!tok.refresh_token) {
				return res.redirect(302, `${returnUrl}#google-photos=refresh`);
			}
			const enc = encryptWithSecret(tok.refresh_token, tokenSecret());
			if (!enc) {
				return res.redirect(302, `${returnUrl}#google-photos=encrypt`);
			}

			if (!queries.upsertGooglePhotosConnection?.run) {
				return res.redirect(302, `${returnUrl}#google-photos=db`);
			}
			await queries.upsertGooglePhotosConnection.run(user.id, {
				refreshTokenEnc: enc,
				scopes: tok.scope || buildScopes()
			});

			// Create default album if missing.
			if (queries.selectGooglePhotosConnectionByUserId?.get && queries.updateGooglePhotosConnectionAlbum?.run) {
				const row = await queries.selectGooglePhotosConnectionByUserId.get(user.id);
				if (!row?.album_id) {
					const accessToken = tok.access_token;
					if (accessToken) {
						const created = await createDefaultAlbum({ accessToken });
						await queries.updateGooglePhotosConnectionAlbum.run(user.id, created);
					}
				}
			}

			return res.redirect(302, `${returnUrl}#google-photos=ok`);
		} catch {
			return res.redirect(302, `${returnUrl}#google-photos=fail`);
		}
	});

	router.post("/api/google-photos/disconnect", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		if (!queries.deleteGooglePhotosConnection?.run) {
			return res.status(500).json({ error: "Server error" });
		}
		await queries.deleteGooglePhotosConnection.run(user.id);
		return res.json({ ok: true });
	});

	router.post("/api/google-photos/upload", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const creationId = Number(req.body?.creationId);
		if (!Number.isFinite(creationId) || creationId <= 0) {
			return res.status(400).json({ error: "Invalid creationId" });
		}
		const albumTitleRaw = typeof req.body?.albumTitle === "string" ? req.body.albumTitle.trim() : "";

		if (
			!queries.selectGooglePhotosConnectionByUserId?.get ||
			!queries.updateGooglePhotosConnectionAlbum?.run
		) {
			return res.status(500).json({ error: "Server error", message: "Google Photos storage is not configured" });
		}

		try {
			const { accessToken } = await getGooglePhotosAccessForUser(user, queries);

			let albumId = "";
			let albumTitle = DEFAULT_ALBUM_TITLE;
			if (albumTitleRaw) {
				const album = await findOrCreateAlbumByTitle({
					accessToken,
					title: albumTitleRaw
				});
				albumId = album.albumId;
				albumTitle = album.albumTitle;
			} else {
				const row = await queries.selectGooglePhotosConnectionByUserId.get(user.id);
				albumId = typeof row.album_id === "string" ? row.album_id : "";
				albumTitle = typeof row.album_title === "string" ? row.album_title : DEFAULT_ALBUM_TITLE;
				if (!albumId) {
					const created = await createDefaultAlbum({ accessToken });
					albumId = created.albumId;
					albumTitle = created.albumTitle;
					await queries.updateGooglePhotosConnectionAlbum.run(user.id, created);
				}
			}

			const created = await uploadPartyCreationToAlbum({
				accessToken,
				albumId,
				creationId,
				user,
				queries,
				storage
			});
			return res.json({
				ok: true,
				albumTitle,
				albumId,
				mediaItemId: created.mediaItemId || null
			});
		} catch (err) {
			const msg = err?.message ? String(err.message) : "Upload failed";
			const status = msg === "Not connected" ? 400 : 500;
			return res.status(status).json({ error: "Upload failed", message: msg });
		}
	});

	router.post("/api/google-photos/sync-party", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const groupId = Number(req.body?.groupId);
		if (!Number.isFinite(groupId) || groupId <= 0) {
			return res.status(400).json({ error: "Invalid groupId" });
		}
		if (!queries.selectCreatedImageById?.get || !queries.updateCreatedImageMeta?.run) {
			return res.status(500).json({ error: "Server error", message: "Party storage is not configured" });
		}

		const row = await queries.selectCreatedImageById.get(groupId, user.id);
		if (!row) {
			return res.status(404).json({ error: "Party group not found" });
		}

		const meta = parseMeta(row.meta) || {};
		if (meta?.party?.mode !== true || meta?.group?.kind !== "group_creations") {
			return res.status(400).json({ error: "Creation is not a party group" });
		}

		const albumTitleRaw = typeof req.body?.albumTitle === "string" ? req.body.albumTitle.trim() : "";
		const partyName =
			albumTitleRaw ||
			(typeof meta?.party?.name === "string" && meta.party.name.trim()) ||
			(typeof meta?.party?.settings?.partyName === "string" && meta.party.settings.partyName.trim()) ||
			(typeof row.title === "string" && row.title.trim()) ||
			DEFAULT_ALBUM_TITLE;

		const pushedRaw = Array.isArray(meta?.party?.pushed) ? meta.party.pushed : [];
		const pushed = filterPartyPushedToGroupSources(meta, normalizePartyPushedEntries(pushedRaw));
		const pushedIds = new Set(pushed.map((entry) => Number(entry.creation_id)));

		try {
			const { accessToken } = await getGooglePhotosAccessForUser(user, queries);
			const album = await findOrCreateAlbumByTitle({ accessToken, title: partyName });
			const albumMedia = await searchAlbumMediaItems({ accessToken, albumId: album.albumId });

			const inAlbumByCreationId = new Map();
			const mediaIdsToRemove = [];
			for (const item of albumMedia) {
				const creationId = parseCreationIdFromPartyMedia(item);
				if (!creationId) continue;
				inAlbumByCreationId.set(creationId, item.id);
				if (!pushedIds.has(creationId)) {
					mediaIdsToRemove.push(item.id);
				}
			}

			let removed = 0;
			if (mediaIdsToRemove.length) {
				const removeResult = await batchRemoveMediaFromAlbum({
					accessToken,
					albumId: album.albumId,
					mediaItemIds: mediaIdsToRemove
				});
				removed = removeResult.removed || mediaIdsToRemove.length;
				for (const creationId of inAlbumByCreationId.keys()) {
					if (!pushedIds.has(creationId)) inAlbumByCreationId.delete(creationId);
				}
			}

			let uploaded = 0;
			let uploadFailed = 0;
			const uploadErrors = [];
			for (const creationId of pushedIds) {
				if (inAlbumByCreationId.has(creationId)) continue;
				try {
					const created = await uploadPartyCreationToAlbum({
						accessToken,
						albumId: album.albumId,
						creationId,
						user,
						queries,
						storage
					});
					if (created.mediaItemId) {
						inAlbumByCreationId.set(creationId, created.mediaItemId);
						uploaded++;
					} else {
						uploadFailed++;
						uploadErrors.push({ creation_id: creationId, error: "Upload missing media item id" });
					}
				} catch (err) {
					uploadFailed++;
					uploadErrors.push({
						creation_id: creationId,
						error: err?.message ? String(err.message).slice(0, 280) : "Upload failed"
					});
				}
			}

			const nextPushed = pushed.map((entry) => {
				const mediaItemId = inAlbumByCreationId.get(Number(entry.creation_id));
				if (!mediaItemId) {
					const next = { ...entry };
					delete next.google_photos_media_item_id;
					delete next.google_photos_album_id;
					return next;
				}
				return {
					...entry,
					google_photos_album_id: album.albumId,
					google_photos_media_item_id: mediaItemId
				};
			});

			const nextMeta = {
				...meta,
				party: {
					...(meta.party && typeof meta.party === "object" ? meta.party : {}),
					pushed: nextPushed,
					google_photos_album_id: album.albumId,
					google_photos_album_title: album.albumTitle
				}
			};

			const metaResult = await queries.updateCreatedImageMeta.run(groupId, user.id, nextMeta);
			if (!metaResult || metaResult.changes === 0) {
				return res.status(500).json({ error: "Failed to save party sync state" });
			}

			return res.json({
				ok: true,
				albumId: album.albumId,
				albumTitle: album.albumTitle,
				uploaded,
				removed,
				uploadFailed,
				pushedCount: pushed.length,
				uploadErrors,
				meta: nextMeta
			});
		} catch (err) {
			const msg = err?.message ? String(err.message) : "Sync failed";
			const status = msg === "Not connected" ? 400 : 500;
			return res.status(status).json({ error: "Sync failed", message: msg });
		}
	});

	router.post("/api/google-photos/remove", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const albumId = typeof req.body?.albumId === "string" ? req.body.albumId.trim() : "";
		const mediaItemIds = Array.isArray(req.body?.mediaItemIds) ? req.body.mediaItemIds : [];
		if (!albumId) {
			return res.status(400).json({ error: "Invalid albumId" });
		}
		if (!mediaItemIds.length) {
			return res.status(400).json({ error: "No media items to remove" });
		}

		const clientId = requiredEnv("GOOGLE_PHOTOS_CLIENT_ID");
		const clientSecret = requiredEnv("GOOGLE_PHOTOS_CLIENT_SECRET");
		if (!clientId || !clientSecret) {
			return res.status(500).json({ error: "Server error", message: "Google Photos is not configured" });
		}

		if (!queries.selectGooglePhotosConnectionByUserId?.get) {
			return res.status(500).json({ error: "Server error", message: "Google Photos storage is not configured" });
		}

		const row = await queries.selectGooglePhotosConnectionByUserId.get(user.id);
		if (!row || row.revoked_at) {
			return res.status(400).json({ error: "Not connected" });
		}

		const refreshToken = decryptWithSecret(row.refresh_token_enc, tokenSecret());
		if (!refreshToken) {
			return res.status(400).json({ error: "Not connected", message: "Invalid credentials" });
		}

		try {
			const access = await refreshAccessToken({ refreshToken, clientId, clientSecret });
			if (!access.access_token) {
				return res.status(500).json({ error: "Server error", message: "Could not authorize remove" });
			}
			const result = await batchRemoveMediaFromAlbum({
				accessToken: access.access_token,
				albumId,
				mediaItemIds
			});
			return res.json(result);
		} catch (err) {
			const msg = err?.message ? String(err.message) : "Remove failed";
			return res.status(500).json({ error: "Remove failed", message: msg });
		}
	});

	return router;
}

