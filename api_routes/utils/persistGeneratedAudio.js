import sharp from "sharp";
import {
	fetchCdnCoverJpeg,
	loadBlueCdnContext,
	mintCdnFetchLink,
	mintCdnUpload,
	pinCdnObject
} from "./blueCdn.js";
function normalizeAudioContentType(value) {
	const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!raw) return "";
	return raw.split(";")[0].trim();
}

export function creationMethodIsAudio(method) {
	const m = String(method || "").toLowerCase();
	return (
		m.includes("speech") ||
		m.includes("music") ||
		m.includes("voicetrain") ||
		m.includes("voice_train") ||
		m.includes("voice-train") ||
		m === "replicateaudio"
	);
}

export function creationMethodMayReturnAudioBytes(method) {
	return creationMethodIsAudio(method);
}

export function isVoiceTrainSuccessBody(body) {
	if (!body || typeof body !== "object") return false;
	const voiceId = typeof body.voice_id === "string" ? body.voice_id.trim() : "";
	return Boolean(voiceId);
}

export function extensionForAudioContentType(contentType) {
	const ct = normalizeAudioContentType(contentType) || "audio/mpeg";
	if (ct.includes("wav")) return "wav";
	if (ct.includes("flac")) return "flac";
	if (ct.includes("ogg")) return "ogg";
	if (ct.includes("mp4") || ct.includes("m4a") || ct.includes("aac")) return "m4a";
	if (ct.includes("webm")) return "webm";
	return "mp3";
}

function parseCreationIdFromVoiceFile(raw) {
	const s = String(raw ?? "").trim();
	if (!s) return null;
	if (/^\d+$/.test(s)) {
		const n = Number(s);
		return Number.isFinite(n) && n > 0 ? n : null;
	}
	const m = s.match(/\/api\/create\/images\/(\d+)\/audio/);
	if (m) {
		const n = Number(m[1]);
		return Number.isFinite(n) && n > 0 ? n : null;
	}
	return null;
}

function parseMeta(raw) {
	if (raw == null) return null;
	if (typeof raw === "object") return raw;
	if (typeof raw !== "string") return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export async function resolveVoiceFileForProvider(queries, userId, args) {
	const next = args && typeof args === "object" ? { ...args } : {};
	const raw = String(next.voice_file ?? "").trim();
	if (!raw) return { ok: true, args: next };
	if (/^https?:\/\//i.test(raw) && !/\/api\/create\/images\/\d+\/audio/i.test(raw)) {
		return { ok: true, args: next };
	}
	const creationId = parseCreationIdFromVoiceFile(raw);
	if (!creationId) return { ok: true, args: next };
	const uid = Number(userId);
	const row = await queries.selectCreatedImageById?.get(creationId, uid);
	if (!row) {
		return { ok: false, status: 404, error: "Audio creation not found" };
	}
	const meta = parseMeta(row.meta);
	const cdnId =
		meta?.audio && typeof meta.audio === "object" && typeof meta.audio.cdn_id === "string"
			? meta.audio.cdn_id.trim()
			: "";
	if (!cdnId) {
		return { ok: false, status: 400, error: "Audio creation has no CDN object" };
	}
	const ctx = await loadBlueCdnContext(queries);
	const link = await mintCdnFetchLink(ctx, cdnId);
	next.voice_file = link.url;
	return { ok: true, args: next };
}

export async function persistGeneratedAudioToCdn({
	queries,
	audioBuffer,
	contentType,
	filename,
	createPlaceholder
}) {
	if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
		const err = new Error("No audio bytes were available to store.");
		err.code = "AUDIO_STORAGE_FAILED";
		throw err;
	}
	const ct = normalizeAudioContentType(contentType) || "audio/mpeg";
	const safeName = String(filename || `generated.${extensionForAudioContentType(ct)}`).slice(0, 200);
	const ctx = await loadBlueCdnContext(queries);
	const minted = await mintCdnUpload(ctx, {
		pin: false,
		contentType: ct,
		filename: safeName
	});
	const putRes = await fetch(minted.upload_url, {
		method: "PUT",
		headers: { "Content-Type": ct },
		body: audioBuffer
	});
	if (!putRes.ok) {
		const err = new Error(`Audio host upload failed (${putRes.status})`);
		err.code = "AUDIO_STORAGE_FAILED";
		throw err;
	}
	await pinCdnObject(ctx, minted.object_id);

	let fetchLink;
	try {
		fetchLink = await mintCdnFetchLink(ctx, minted.object_id);
	} catch {
		fetchLink = null;
	}

	let coverBuffer = null;
	let usedPlaceholder = false;
	if (fetchLink?.url) {
		try {
			coverBuffer = await fetchCdnCoverJpeg(fetchLink.url);
		} catch {
			coverBuffer = null;
		}
	}
	if (!coverBuffer && typeof createPlaceholder === "function") {
		coverBuffer = await createPlaceholder();
		usedPlaceholder = true;
	}
	if (!coverBuffer) {
		const err = new Error("Could not build a cover for generated audio.");
		err.code = "AUDIO_STORAGE_FAILED";
		throw err;
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

	return {
		coverBuffer: pngBuffer,
		width,
		height,
		usedPlaceholder,
		audio: {
			cdn_id: minted.object_id,
			content_type: ct,
			filename: safeName
		}
	};
}
