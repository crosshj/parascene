import crypto from "crypto";
import path from "path";
import {
	CDN_OBJECT_ID_RE,
	loadBlueCdnContext,
	mintCdnFetchLink,
	mintCdnUpload
} from "./blueCdn.js";
import { listProviderInputImageRefs } from "./normalizeProviderInputImages.js";

export const STILL_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const STILL_UPLOAD_TICKET_TTL_MS = 10 * 60 * 1000;
export const STILL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const ALLOWED_STILL_CONTENT_TYPES = new Set(["image/jpeg", "image/jpg"]);

export const EPHEMERAL_STILL_PATH_RE =
	/\/api\/create\/ephemeral-still\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/;

function getTicketSecret() {
	return process.env.SESSION_SECRET || "dev-secret-change-me";
}

function httpError(status, message, code) {
	const err = new Error(message);
	err.status = status;
	if (code) err.code = code;
	return err;
}

export function normalizeStillContentType(value) {
	const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!raw) return "";
	const ct = raw.split(";")[0].trim();
	if (ct === "image/jpg") return "image/jpeg";
	return ct;
}

export function normalizeStillFilename(value) {
	const raw = typeof value === "string" ? value.trim() : "";
	if (!raw) return "frame.jpg";
	const base = path.basename(raw).replace(/[\u0000-\u001f]/g, "");
	return (base || "frame.jpg").slice(0, 200);
}

function mintSigned({ userId, objectId, contentType, filename, kind, exp }) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) {
		throw httpError(401, "Unauthorized");
	}
	if (!CDN_OBJECT_ID_RE.test(objectId)) {
		throw httpError(400, "Invalid still object");
	}
	const payload = Buffer.from(
		JSON.stringify({
			k: kind,
			u: uid,
			o: objectId,
			ct: normalizeStillContentType(contentType),
			f: normalizeStillFilename(filename),
			exp: Number(exp)
		}),
		"utf8"
	).toString("base64url");
	const sig = crypto.createHmac("sha256", getTicketSecret()).update(payload).digest("base64url");
	return `${payload}.${sig}`;
}

function verifySigned(token, { userId, kind } = {}) {
	const raw = typeof token === "string" ? token.trim() : "";
	const parts = raw.split(".");
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		throw httpError(400, "Invalid still ticket", "INVALID_TICKET");
	}
	const [payloadB64, sig] = parts;
	const expected = crypto.createHmac("sha256", getTicketSecret()).update(payloadB64).digest("base64url");
	const sigBuf = Buffer.from(sig);
	const expectedBuf = Buffer.from(expected);
	if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
		throw httpError(400, "Invalid still ticket", "INVALID_TICKET");
	}
	let payload;
	try {
		payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
	} catch {
		throw httpError(400, "Invalid still ticket", "INVALID_TICKET");
	}
	const uid = Number(payload?.u);
	const objectId = typeof payload?.o === "string" ? payload.o.trim() : "";
	const exp = Number(payload?.exp);
	const tokenKind = typeof payload?.k === "string" ? payload.k : "";
	if (kind && tokenKind !== kind) {
		throw httpError(400, "Invalid still ticket", "INVALID_TICKET");
	}
	if (!Number.isFinite(uid) || uid <= 0 || !CDN_OBJECT_ID_RE.test(objectId)) {
		throw httpError(400, "Invalid still ticket", "INVALID_TICKET");
	}
	if (userId != null && Number(userId) !== uid) {
		throw httpError(403, "Still ticket belongs to another user", "TICKET_USER_MISMATCH");
	}
	if (!Number.isFinite(exp) || exp <= Date.now()) {
		throw httpError(400, "Still expired — extract again", "TICKET_EXPIRED");
	}
	return {
		userId: uid,
		objectId,
		contentType: normalizeStillContentType(payload.ct),
		filename: normalizeStillFilename(payload.f),
		kind: tokenKind,
		exp
	};
}

export function mintStillUploadTicket(opts) {
	return mintSigned({
		...opts,
		kind: "up",
		exp: opts.exp ?? Date.now() + STILL_UPLOAD_TICKET_TTL_MS
	});
}

export function verifyStillUploadTicket(ticket, opts) {
	return verifySigned(ticket, { ...opts, kind: "up" });
}

export function mintStillFetchToken(opts) {
	return mintSigned({
		...opts,
		kind: "st",
		exp: opts.exp ?? Date.now() + STILL_TOKEN_TTL_MS
	});
}

export function verifyStillFetchToken(token, opts) {
	return verifySigned(token, { ...opts, kind: "st" });
}

export function stillTokenFromUrl(url) {
	const m = String(url || "").match(EPHEMERAL_STILL_PATH_RE);
	return m ? m[1] : "";
}

export function ephemeralStillPath(token) {
	return `/api/create/ephemeral-still/${token}`;
}

export async function startEphemeralStill({ userId, filename, contentType, queries }) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) {
		throw httpError(401, "Unauthorized");
	}
	const ct = normalizeStillContentType(contentType);
	if (!ALLOWED_STILL_CONTENT_TYPES.has(ct)) {
		throw httpError(400, "Use a JPEG still.");
	}
	const safeName = normalizeStillFilename(filename);
	const ctx = await loadBlueCdnContext(queries);
	const minted = await mintCdnUpload(ctx, {
		pin: false,
		contentType: ct,
		filename: safeName
	});
	const ticket = mintStillUploadTicket({
		userId: uid,
		objectId: minted.object_id,
		contentType: ct,
		filename: safeName
	});
	return {
		ticket,
		upload_url: minted.upload_url,
		expires_at: minted.expires_at,
		max_bytes: STILL_UPLOAD_MAX_BYTES
	};
}

export async function finalizeEphemeralStill({ userId, ticket, queries }) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) {
		throw httpError(401, "Unauthorized");
	}
	const claimed = verifyStillUploadTicket(ticket, { userId: uid });
	const ctx = await loadBlueCdnContext(queries);
	try {
		await mintCdnFetchLink(ctx, claimed.objectId);
	} catch (err) {
		if (err?.status === 409) {
			throw httpError(409, "Upload is not finished yet");
		}
		throw err;
	}
	const token = mintStillFetchToken({
		userId: uid,
		objectId: claimed.objectId,
		contentType: claimed.contentType,
		filename: claimed.filename
	});
	return {
		still_url: ephemeralStillPath(token),
		expires_at: new Date(Date.now() + STILL_TOKEN_TTL_MS).toISOString()
	};
}

export async function mintEphemeralStillFetch({ userId, token, queries, mintFetch }) {
	const claimed = verifyStillFetchToken(token, userId != null ? { userId } : {});
	if (typeof mintFetch === "function") {
		return mintFetch(claimed.objectId);
	}
	const ctx = await loadBlueCdnContext(queries);
	return mintCdnFetchLink(ctx, claimed.objectId);
}

/**
 * Rewrite Parascene ephemeral still_url values to minted Blue fetch URLs
 * so the generate server can GET them without auth.
 */
export async function resolveEphemeralStillProviderArgs(
	args,
	{ userId, queries, mintFetch } = {},
) {
	if (!args || typeof args !== "object") {
		return { ok: true, handled: false, args: args || {} };
	}
	const next = { ...args };
	if (Array.isArray(next.input_images)) {
		next.input_images = [...next.input_images];
	}
	const refs = listProviderInputImageRefs(next);
	let handled = false;
	for (const ref of refs) {
		const token = stillTokenFromUrl(ref.url);
		if (!token) continue;
		try {
			const link = await mintEphemeralStillFetch({
				userId,
				token,
				queries,
				mintFetch
			});
			if (ref.key === "input_images" && ref.index != null && Array.isArray(next.input_images)) {
				next.input_images[ref.index] = link.url;
			} else {
				next[ref.key] = link.url;
			}
			handled = true;
		} catch (err) {
			return {
				ok: false,
				handled: true,
				status: Number(err?.status) || 400,
				code: err?.code || "still_resolve_failed",
				error: err?.message || "Could not resolve ephemeral still.",
				args: next
			};
		}
	}
	return { ok: true, handled, args: next };
}
