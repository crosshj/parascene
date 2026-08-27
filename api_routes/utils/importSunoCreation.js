import sharp from "sharp";
import {
	isSunoSongImportUrl,
	resolveSunoSongFromUrl,
} from "../suno.js";
import {
	createPlaceholderImageBuffer,
} from "./creationJob.js";
import { fetchImportCoverImageBuffer } from "./importCoverImage.js";
import { getSupabaseServiceClient } from "./supabaseService.js";

async function findExistingSunoImportId(userId, songId) {
	const supabase = getSupabaseServiceClient();
	if (!supabase) return null;
	try {
		const { data, error } = await supabase
			.from("prsn_created_images")
			.select("id")
			.eq("user_id", userId)
			.filter("meta->import->>provider", "eq", "suno")
			.filter("meta->import->>song_id", "eq", songId)
			.is("unavailable_at", null)
			.order("created_at", { ascending: false })
			.limit(1)
			.maybeSingle();
		if (error) return null;
		const id = Number(data?.id);
		return Number.isFinite(id) && id > 0 ? id : null;
	} catch {
		return null;
	}
}

/**
 * Resolve a Suno URL and check whether this user already imported the song.
 * Does not create a creation.
 *
 * @param {{ userId: number, url: string }} params
 * @returns {Promise<{ songId: string, title: string, url: string, cover_url: string, existing_id: number|null }>}
 */
export async function previewSunoImport({ userId, url }) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) {
		const err = new Error("Unauthorized");
		err.status = 401;
		throw err;
	}

	const rawUrl = typeof url === "string" ? url.trim() : "";
	if (!rawUrl || !isSunoSongImportUrl(rawUrl)) {
		const err = new Error("Paste a suno.com song link");
		err.status = 400;
		err.code = "INVALID_SUNO_URL";
		throw err;
	}

	let resolved;
	try {
		resolved = await resolveSunoSongFromUrl(rawUrl);
	} catch (err) {
		if (!err.status) err.status = 502;
		throw err;
	}

	const existingId = await findExistingSunoImportId(uid, resolved.songId);
	const coverUrl = typeof resolved.ogImage === "string" ? resolved.ogImage.trim() : "";
	return {
		songId: resolved.songId,
		title: resolved.title || "",
		url: resolved.url,
		cover_url: coverUrl,
		existing_id: existingId,
	};
}

/**
 * Import a Suno song URL as a completed audio creation (cover + embed meta).
 * Missing/failed covers fall back to a placeholder — never fails the import for cover alone.
 *
 * @param {{
 *   userId: number,
 *   url: string,
 *   creationToken?: string,
 *   queries: object,
 *   storage: { uploadImage?: Function },
 * }} params
 */
export async function importSunoCreation({ userId, url, creationToken, queries, storage }) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) {
		const err = new Error("Unauthorized");
		err.status = 401;
		throw err;
	}
	if (typeof storage?.uploadImage !== "function") {
		const err = new Error("Image upload not available");
		err.status = 503;
		throw err;
	}
	if (typeof queries?.insertCreatedImage?.run !== "function") {
		const err = new Error("Create storage not available");
		err.status = 503;
		throw err;
	}

	const rawUrl = typeof url === "string" ? url.trim() : "";
	if (!rawUrl || !isSunoSongImportUrl(rawUrl)) {
		const err = new Error("Paste a suno.com song link");
		err.status = 400;
		err.code = "INVALID_SUNO_URL";
		throw err;
	}

	let resolved;
	try {
		resolved = await resolveSunoSongFromUrl(rawUrl);
	} catch (err) {
		if (!err.status) err.status = 502;
		throw err;
	}

	const existingId = await findExistingSunoImportId(uid, resolved.songId);

	let coverBuffer = null;
	let usedPlaceholder = false;
	if (resolved.ogImage) {
		try {
			coverBuffer = await fetchImportCoverImageBuffer(resolved.ogImage, {
				userAgent: "parascene-suno-import",
			});
		} catch {
			coverBuffer = null;
		}
	}
	if (!coverBuffer) {
		coverBuffer = await createPlaceholderImageBuffer();
		usedPlaceholder = true;
	}

	let width = 1024;
	let height = 1024;
	try {
		const metaSharp = await sharp(coverBuffer, { failOn: "none" }).metadata();
		if (typeof metaSharp.width === "number" && metaSharp.width > 0) width = metaSharp.width;
		if (typeof metaSharp.height === "number" && metaSharp.height > 0) height = metaSharp.height;
	} catch {
		// keep defaults
	}

	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 9);
	const filename = `${uid}_${timestamp}_${random}.png`;
	const filePath = await storage.uploadImage(coverBuffer, filename);

	const title =
		typeof resolved.title === "string" && resolved.title.trim()
			? resolved.title.trim().slice(0, 200)
			: null;

	const meta = {
		media_type: "audio",
		import: {
			provider: "suno",
			song_id: resolved.songId,
			url: resolved.url,
			embed_url: resolved.embedUrl,
			title: resolved.title || "",
			creator: resolved.creator || "",
		},
		completed_at: new Date().toISOString(),
		...(usedPlaceholder ? { cover_placeholder: true } : {}),
		...(typeof creationToken === "string" && creationToken.trim()
			? { creation_token: creationToken.trim() }
			: {}),
	};

	const insertResult = await queries.insertCreatedImage.run(
		uid,
		filename,
		filePath,
		width,
		height,
		null,
		"completed",
		meta
	);
	const creationId = Number(insertResult?.insertId);
	if (!Number.isFinite(creationId) || creationId <= 0) {
		const err = new Error("Failed to create song");
		err.status = 500;
		throw err;
	}

	if (title && typeof queries.updateCreatedImage?.run === "function") {
		try {
			await queries.updateCreatedImage.run(creationId, uid, title, null, false);
		} catch {
			// Title is best-effort; creation still succeeded.
		}
	}

	return {
		id: creationId,
		status: "completed",
		media_type: "audio",
		title: title || "",
		url: filePath,
		warning: existingId
			? {
					code: "duplicate_import",
					message: "You already imported this song",
					existing_id: existingId,
				}
			: null,
	};
}
