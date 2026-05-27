import crypto from "crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "./auth.js";
import { getBaseAppUrl } from "./utils/url.js";

const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const PHOTOS_UPLOAD_URL = "https://photoslibrary.googleapis.com/v1/uploads";
const PHOTOS_ALBUMS_URL = "https://photoslibrary.googleapis.com/v1/albums";
const PHOTOS_BATCH_CREATE_URL = "https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate";

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
		"https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata"
	].join(" ");
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

async function createDefaultAlbum({ accessToken }) {
	const { ok, data, text } = await fetchJson(PHOTOS_ALBUMS_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ album: { title: DEFAULT_ALBUM_TITLE } })
	});
	if (!ok) {
		const msg = data?.error?.message || text || "Album create failed";
		throw new Error(String(msg));
	}
	const id = typeof data?.id === "string" ? data.id : "";
	if (!id) throw new Error("Album create failed");
	return { albumId: id, albumTitle: DEFAULT_ALBUM_TITLE };
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

async function batchCreateMediaItem({ accessToken, uploadToken, albumId, filename }) {
	const body = {
		albumId,
		newMediaItems: [
			{
				description: "Uploaded from Parascene",
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
	return { ok: true };
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

		const clientId = requiredEnv("GOOGLE_PHOTOS_CLIENT_ID");
		const clientSecret = requiredEnv("GOOGLE_PHOTOS_CLIENT_SECRET");
		if (!clientId || !clientSecret) {
			return res.status(500).json({ error: "Server error", message: "Google Photos is not configured" });
		}

		if (
			!queries.selectGooglePhotosConnectionByUserId?.get ||
			!queries.updateGooglePhotosConnectionAlbum?.run
		) {
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

		let albumId = typeof row.album_id === "string" ? row.album_id : "";
		let albumTitle = typeof row.album_title === "string" ? row.album_title : DEFAULT_ALBUM_TITLE;

		try {
			const access = await refreshAccessToken({ refreshToken, clientId, clientSecret });
			if (!access.access_token) {
				return res.status(500).json({ error: "Server error", message: "Could not authorize upload" });
			}

			// Ensure default album exists.
			if (!albumId) {
				const created = await createDefaultAlbum({ accessToken: access.access_token });
				albumId = created.albumId;
				albumTitle = created.albumTitle;
				await queries.updateGooglePhotosConnectionAlbum.run(user.id, created);
			}

			// Load creation still image bytes (same behavior as device image share).
			if (!queries.selectCreatedImageById?.get) {
				return res.status(500).json({ error: "Server error", message: "Creation lookup not available" });
			}
			const image = await queries.selectCreatedImageById.get(creationId, user.id);
			if (!image || !image.filename) {
				return res.status(404).json({ error: "Creation not found" });
			}
			const bytes = await storage.getImageBuffer(image.filename);
			const filename = `parascene-${creationId}.png`;
			const uploadToken = await uploadBytesToPhotos({
				accessToken: access.access_token,
				bytes,
				filename
			});
			await batchCreateMediaItem({
				accessToken: access.access_token,
				uploadToken,
				albumId,
				filename
			});
			return res.json({ ok: true, albumTitle });
		} catch (err) {
			const msg = err?.message ? String(err.message) : "Upload failed";
			return res.status(500).json({ error: "Upload failed", message: msg });
		}
	});

	return router;
}

