import { creationVideoMediaKey } from "../../db/creations.js";
import { extractVideoAudio } from "../../routes/utils/media.js";
import {
	buildGenericAudioUrl,
	ensureAudioClipLibraryRowFromShareAudio,
	resolveClipIdFromOutputMeta,
} from "./audioClips.js";

function fail(status, error, message = error) {
	const err = new Error(message);
	err.status = status;
	err.publicError = error;
	return err;
}

function parseMeta(raw) {
	if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
	if (typeof raw !== "string" || !raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * Extract a creation video's audio on the server and store it as share audio.
 * @param {{
 *   queries: object,
 *   storage: { getVideoBuffer?: Function, uploadGenericImage?: Function },
 *   user: { id: number, role?: string },
 *   creationId: number,
 *   extractAudio?: typeof extractVideoAudio,
 * }} deps
 */
export async function saveShareAudioFromVideo({ queries, storage, user, creationId, extractAudio = extractVideoAudio }) {
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) throw fail(400, "Invalid creation id");

	let image = await queries.selectCreatedImageById?.get(id, user.id);
	if (!image) {
		image = await queries.selectCreatedImageByIdAnyUser?.get(id);
		if (!image) throw fail(404, "Creation not found");
		const isOwner = Number(image.user_id) === Number(user.id);
		const isAdmin = user.role === "admin";
		const isPublished = image.published === 1 || image.published === true;
		if (!isOwner && !isAdmin && !isPublished) throw fail(403, "Forbidden");
	}

	if ((image.status || "") !== "completed") {
		throw fail(400, "Only completed creations support share audio");
	}

	const existingMeta = parseMeta(image.meta);
	if (existingMeta?.group?.kind === "group_creations") {
		throw fail(400, "Share audio is not available for grouped creations");
	}
	const videoKey = creationVideoMediaKey(image);
	if (existingMeta.media_type !== "video" || !videoKey) {
		throw fail(400, "Share audio is only available for video creations");
	}

	const libraryAudioClipId = await resolveClipIdFromOutputMeta(queries, existingMeta);
	if (libraryAudioClipId) {
		throw fail(400, "Share audio is not available for creations that use a library audio clip");
	}

	const existingShareAudio =
		existingMeta.share_audio && typeof existingMeta.share_audio === "object" ? existingMeta.share_audio : null;
	const existingKey = typeof existingShareAudio?.key === "string" ? existingShareAudio.key.trim() : "";
	const existingPath = typeof existingShareAudio?.file_path === "string" ? existingShareAudio.file_path.trim() : "";
	if (existingKey || existingPath) {
		void ensureAudioClipLibraryRowFromShareAudio({
			queries,
			storageKey: existingKey,
			mimeType: existingShareAudio?.content_type,
			byteSize: 0,
			extractorUserId: user.id,
			sourceCreation: image,
			durationSec: existingShareAudio?.duration_sec,
		});
		return {
			ok: true,
			audio_url: existingPath || buildGenericAudioUrl(existingKey),
			share_audio: existingShareAudio,
			already_exists: true,
		};
	}

	if (typeof storage?.getVideoBuffer !== "function" || typeof storage?.uploadGenericImage !== "function") {
		throw fail(503, "Audio storage not available");
	}

	let videoBuffer;
	try {
		videoBuffer = await storage.getVideoBuffer(videoKey);
	} catch {
		throw fail(404, "Video not found");
	}
	if (!Buffer.isBuffer(videoBuffer) || videoBuffer.length === 0) {
		throw fail(404, "Video not found");
	}

	const extracted = await extractAudio(videoBuffer);
	if (!extracted?.buffer?.length) {
		throw fail(422, "Could not extract audio", "This video has no audio track");
	}

	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 9);
	const storageKey = `share-audio/${image.user_id}_${id}_${timestamp}_${random}.m4a`;
	await storage.uploadGenericImage(extracted.buffer, storageKey, { contentType: extracted.contentType });
	const audioUrl = buildGenericAudioUrl(storageKey);
	const shareAudio = {
		key: storageKey,
		file_path: audioUrl,
		content_type: extracted.contentType,
		extracted_at: new Date().toISOString(),
		...(extracted.durationSec != null ? { duration_sec: extracted.durationSec } : {}),
	};
	const updateResult = await queries.updateCreatedImageMeta.run(id, image.user_id, {
		...existingMeta,
		share_audio: shareAudio,
	});
	if (!updateResult || updateResult.changes === 0) {
		throw fail(500, "Failed to save audio reference on creation");
	}

	void ensureAudioClipLibraryRowFromShareAudio({
		queries,
		storageKey,
		mimeType: extracted.contentType,
		byteSize: extracted.buffer.length,
		extractorUserId: user.id,
		sourceCreation: image,
		durationSec: extracted.durationSec,
	});

	return { ok: true, audio_url: audioUrl, share_audio: shareAudio };
}
