import crypto from "crypto";
import path from "path";
import sharp from "sharp";
import { createPlaceholderImageBuffer } from "./creationJob.js";
import {
	CDN_OBJECT_ID_RE,
	fetchCdnCoverJpeg,
	loadBlueCdnContext,
	mintCdnFetchLink,
	mintCdnUpload,
	pinCdnObject
} from "./blueCdn.js";

export const AUDIO_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const AUDIO_IMPORT_TICKET_TTL_MS = 10 * 60 * 1000;

export const ALLOWED_AUDIO_CONTENT_TYPES = new Set([
	"audio/mpeg",
	"audio/mp3",
	"audio/wav",
	"audio/x-wav",
	"audio/flac",
	"audio/ogg",
	"audio/mp4",
	"audio/aac",
	"audio/x-m4a",
	"audio/webm"
]);

function getTicketSecret() {
	return process.env.SESSION_SECRET || "dev-secret-change-me";
}

function httpError(status, message, code) {
	const err = new Error(message);
	err.status = status;
	if (code) err.code = code;
	return err;
}

export function normalizeAudioContentType(value) {
	const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!raw) return "";
	return raw.split(";")[0].trim();
}

export function normalizeAudioFilename(value) {
	const raw = typeof value === "string" ? value.trim() : "";
	if (!raw) return "audio";
	const base = path.basename(raw).replace(/[\u0000-\u001f]/g, "");
	return (base || "audio").slice(0, 200);
}

export function titleFromAudioFilename(filename) {
	const base = normalizeAudioFilename(filename);
	const stem = base.replace(/\.[a-z0-9]{1,8}$/i, "").trim();
	return (stem || "Audio").slice(0, 200);
}

export function mintAudioImportTicket({ userId, objectId, contentType, filename, exp = Date.now() + AUDIO_IMPORT_TICKET_TTL_MS }) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) {
		throw httpError(401, "Unauthorized");
	}
	if (!CDN_OBJECT_ID_RE.test(objectId)) {
		throw httpError(400, "Invalid audio object");
	}
	const payload = Buffer.from(
		JSON.stringify({
			u: uid,
			o: objectId,
			ct: normalizeAudioContentType(contentType),
			f: normalizeAudioFilename(filename),
			exp: Number(exp)
		}),
		"utf8"
	).toString("base64url");
	const sig = crypto.createHmac("sha256", getTicketSecret()).update(payload).digest("base64url");
	return `${payload}.${sig}`;
}

export function verifyAudioImportTicket(ticket, { userId } = {}) {
	const raw = typeof ticket === "string" ? ticket.trim() : "";
	const parts = raw.split(".");
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		throw httpError(400, "Invalid upload ticket", "INVALID_TICKET");
	}
	const [payloadB64, sig] = parts;
	const expected = crypto.createHmac("sha256", getTicketSecret()).update(payloadB64).digest("base64url");
	const sigBuf = Buffer.from(sig);
	const expectedBuf = Buffer.from(expected);
	if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
		throw httpError(400, "Invalid upload ticket", "INVALID_TICKET");
	}
	let payload;
	try {
		payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
	} catch {
		throw httpError(400, "Invalid upload ticket", "INVALID_TICKET");
	}
	const uid = Number(payload?.u);
	const objectId = typeof payload?.o === "string" ? payload.o.trim() : "";
	const exp = Number(payload?.exp);
	if (!Number.isFinite(uid) || uid <= 0 || !CDN_OBJECT_ID_RE.test(objectId)) {
		throw httpError(400, "Invalid upload ticket", "INVALID_TICKET");
	}
	if (userId != null && Number(userId) !== uid) {
		throw httpError(403, "Upload ticket belongs to another user", "TICKET_USER_MISMATCH");
	}
	if (!Number.isFinite(exp) || exp <= Date.now()) {
		throw httpError(400, "Upload expired — start again", "TICKET_EXPIRED");
	}
	return {
		userId: uid,
		objectId,
		contentType: normalizeAudioContentType(payload.ct),
		filename: normalizeAudioFilename(payload.f),
		exp
	};
}

export async function startAudioFileImport({ userId, filename, contentType, queries }) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) {
		throw httpError(401, "Unauthorized");
	}
	const ct = normalizeAudioContentType(contentType);
	if (!ALLOWED_AUDIO_CONTENT_TYPES.has(ct)) {
		throw httpError(400, "Use an audio file (mp3, wav, flac, m4a, ogg, aac).");
	}
	const safeName = normalizeAudioFilename(filename);
	const ctx = await loadBlueCdnContext(queries);
	const minted = await mintCdnUpload(ctx, {
		pin: false,
		contentType: ct,
		filename: safeName
	});
	const ticket = mintAudioImportTicket({
		userId: uid,
		objectId: minted.object_id,
		contentType: ct,
		filename: safeName
	});
	return {
		ticket,
		upload_url: minted.upload_url,
		expires_at: minted.expires_at,
		max_bytes: AUDIO_UPLOAD_MAX_BYTES
	};
}

function parseOptionalDuration(value) {
	if (value == null || value === "") return null;
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0 || n > 24 * 60 * 60) return null;
	return Math.round(n * 1000) / 1000;
}

export async function finalizeAudioFileImport({
	userId,
	ticket,
	title,
	durationSec,
	creationToken,
	queries,
	storage
}) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) {
		throw httpError(401, "Unauthorized");
	}
	if (typeof storage?.uploadImage !== "function") {
		throw httpError(503, "Image upload not available");
	}
	if (typeof queries?.insertCreatedImage?.run !== "function") {
		throw httpError(503, "Create storage not available");
	}

	const claimed = verifyAudioImportTicket(ticket, { userId: uid });
	const ctx = await loadBlueCdnContext(queries);

	let fetchLink;
	try {
		fetchLink = await mintCdnFetchLink(ctx, claimed.objectId);
	} catch (err) {
		if (err?.status === 409) {
			throw httpError(409, "Upload is not finished yet");
		}
		throw err;
	}

	let coverBuffer = null;
	let usedPlaceholder = false;
	try {
		coverBuffer = await fetchCdnCoverJpeg(fetchLink.url);
	} catch {
		coverBuffer = null;
	}
	if (!coverBuffer) {
		coverBuffer = await createPlaceholderImageBuffer();
		usedPlaceholder = true;
	}

	let pngBuffer = coverBuffer;
	let width = 1024;
	let height = 1024;
	try {
		const image = sharp(coverBuffer, { failOn: "none" });
		const metaSharp = await image.metadata();
		if (typeof metaSharp.width === "number" && metaSharp.width > 0) width = metaSharp.width;
		if (typeof metaSharp.height === "number" && metaSharp.height > 0) height = metaSharp.height;
		pngBuffer = await image.png().toBuffer();
	} catch {
		pngBuffer = coverBuffer;
	}

	try {
		await pinCdnObject(ctx, claimed.objectId);
	} catch (err) {
		if (err?.status === 409) {
			throw httpError(409, "Upload is not finished yet");
		}
		throw err;
	}

	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 9);
	const stillFilename = `${uid}_${timestamp}_${random}.png`;
	const filePath = await storage.uploadImage(pngBuffer, stillFilename);

	const duration = parseOptionalDuration(durationSec);
	const requestedTitle = typeof title === "string" && title.trim() ? title.trim().slice(0, 200) : "";
	const resolvedTitle = requestedTitle || titleFromAudioFilename(claimed.filename);

	const meta = {
		media_type: "audio",
		audio: {
			cdn_id: claimed.objectId,
			content_type: claimed.contentType,
			filename: claimed.filename,
			...(duration != null ? { duration } : {})
		},
		import: {
			provider: "file",
			filename: claimed.filename
		},
		completed_at: new Date().toISOString(),
		...(usedPlaceholder ? { cover_placeholder: true } : {}),
		...(typeof creationToken === "string" && creationToken.trim()
			? { creation_token: creationToken.trim() }
			: {})
	};

	const insertResult = await queries.insertCreatedImage.run(
		uid,
		stillFilename,
		filePath,
		width,
		height,
		null,
		"completed",
		meta
	);
	const creationId = Number(insertResult?.insertId);
	if (!Number.isFinite(creationId) || creationId <= 0) {
		throw httpError(500, "Failed to create audio");
	}

	if (resolvedTitle && typeof queries.updateCreatedImage?.run === "function") {
		try {
			await queries.updateCreatedImage.run(creationId, uid, resolvedTitle, null, false);
		} catch {
			// Title is best-effort.
		}
	}

	return {
		id: creationId,
		status: "completed",
		media_type: "audio",
		title: resolvedTitle,
		url: filePath,
		audio_url: `/api/create/images/${creationId}/audio`
	};
}
