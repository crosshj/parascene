import sharp from "sharp";
import { isPlaceholderAudioCover } from "./audioCoverPublic.js";
import { parseCreationIdFromLink } from "./audioClips.js";
import { extractFilenameFromCreatedImagePath } from "./resolveCreatedImageStorageFilename.js";
import { buildProceduralAudioCoverBuffer, resolveAudioCoverKind, seedAudioCover } from "./audioCoverProcedural.js";

export const REAL_AUDIO_COVER_SOURCES = new Set([
	"procedural",
	"upload",
	"generate",
	"import",
	"embedded",
]);

export function parseCreationMeta(raw) {
	if (raw == null) return null;
	if (typeof raw === "object") return raw;
	if (typeof raw !== "string") return null;
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

export function seedAudioCoverFromCreation(image, meta) {
	const args = meta?.args && typeof meta.args === "object" ? meta.args : {};
	const prompt = typeof args.prompt === "string" ? args.prompt : "";
	const title = typeof image?.title === "string" ? image.title : "";
	const extra =
		meta?.audio && typeof meta.audio === "object" && typeof meta.audio.cdn_id === "string"
			? meta.audio.cdn_id
			: "";
	return seedAudioCover({
		creationId: image?.id,
		userId: image?.user_id,
		title: title || prompt,
		prompt,
		extra,
	});
}

function audioImportProvider(meta) {
	const provider = meta?.import && typeof meta.import === "object" ? meta.import.provider : "";
	return typeof provider === "string" ? provider.trim().toLowerCase() : "";
}

/** Infer factory cover source when older imports never stored cover_source. */
export function inferAudioCoverSource(meta) {
	const source = typeof meta?.cover_source === "string" ? meta.cover_source.trim() : "";
	if (REAL_AUDIO_COVER_SOURCES.has(source)) return source;
	const provider = audioImportProvider(meta);
	if (provider === "suno" || provider === "youtube") return "import";
	if (provider === "file") return "embedded";
	return "";
}

export function snapshotCoverOriginal(image, meta) {
	if (meta?.cover_original && typeof meta.cover_original.file_path === "string" && meta.cover_original.file_path.trim()) {
		return meta.cover_original;
	}
	const filePath = typeof image?.file_path === "string" ? image.file_path.trim() : "";
	if (!filePath || meta?.cover_placeholder === true || isPlaceholderAudioCover(filePath)) return null;
	return {
		file_path: filePath,
		filename: typeof image?.filename === "string" ? image.filename : "",
		width: Number(image?.width) > 0 ? Number(image.width) : 1024,
		height: Number(image?.height) > 0 ? Number(image.height) : 1024,
		cover_source: inferAudioCoverSource(meta) || "procedural",
	};
}

export function canResetAudioCover(meta) {
	const source = typeof meta?.cover_source === "string" ? meta.cover_source.trim() : "";
	if (source === "upload" || source === "generate") return true;
	return Boolean(meta?.cover_original?.file_path);
}

export function audioCreationNeedsCoverBackfill(image, meta) {
	if (!isAudioCreationRow(image, meta)) return false;
	if (meta?.cover_placeholder === true) return true;
	const filePath = typeof image?.file_path === "string" ? image.file_path.trim() : "";
	if (!filePath || isPlaceholderAudioCover(filePath)) return true;
	if (audioImportProvider(meta)) return false;
	const source = typeof meta?.cover_source === "string" ? meta.cover_source.trim() : "";
	if (source === "upload" || source === "generate" || source === "procedural") return false;
	// Generated Blue audio has no ID3 art. A CDN `?cover=1` stub was stored as
	// "embedded" (or source was never set) and shows as a grey square.
	return true;
}

/** Reject flat / tiny / empty stills so we generate a real cover instead. */
export async function isUsableStillCoverBuffer(buffer) {
	if (!Buffer.isBuffer(buffer) || buffer.length < 32) return false;
	try {
		const image = sharp(buffer, { failOn: "none" });
		const meta = await image.metadata();
		const width = Number(meta.width) || 0;
		const height = Number(meta.height) || 0;
		if (width < 64 || height < 64) return false;
		const stats = await sharp(buffer, { failOn: "none" }).stats();
		const channels = Array.isArray(stats.channels) ? stats.channels : [];
		if (channels.length >= 4) {
			const alpha = channels[3];
			if (Number(alpha?.mean) < 16) return false;
		}
		const rgb = channels.slice(0, 3);
		if (!rgb.length) return false;
		const maxStdev = Math.max(...rgb.map((c) => Number(c.stdev) || 0));
		return maxStdev >= 12;
	} catch {
		return false;
	}
}

export function isAudioCreationRow(image, meta) {
	const media = String(meta?.media_type || image?.media_type || "").trim().toLowerCase();
	if (media === "audio") return true;
	const cdnId = meta?.audio && typeof meta.audio === "object" ? String(meta.audio.cdn_id || "").trim() : "";
	return Boolean(cdnId);
}

export async function squarePngCoverBuffer(buffer) {
	if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
		throw new Error("Empty cover image");
	}
	const png = await sharp(buffer, { failOn: "none" })
		.rotate()
		.resize(1024, 1024, { fit: "cover" })
		.png()
		.toBuffer();
	const metaSharp = await sharp(png).metadata();
	const width = Number(metaSharp.width) > 0 ? Number(metaSharp.width) : 1024;
	const height = Number(metaSharp.height) > 0 ? Number(metaSharp.height) : 1024;
	return { png, width, height };
}

/**
 * Replace the still on an existing audio creation. Does not change status.
 */
export async function applyAudioCoverBuffer({
	queries,
	storage,
	image,
	buffer,
	coverSource,
	extraMeta = {},
}) {
	if (!image || typeof storage?.uploadImage !== "function") {
		const err = new Error("Cover storage is not available");
		err.status = 503;
		throw err;
	}
	if (!REAL_AUDIO_COVER_SOURCES.has(coverSource)) {
		const err = new Error("Invalid cover source");
		err.status = 400;
		throw err;
	}
	const { png, width, height } = await squarePngCoverBuffer(buffer);
	const timestamp = Date.now();
	const random = Math.random().toString(36).slice(2, 9);
	const filename = `${image.user_id}_${image.id}_${timestamp}_${random}.png`;
	const filePath = await storage.uploadImage(png, filename);
	const existingMeta = parseCreationMeta(image.meta) || {};
	const { cover_original: extraOriginal, ...restExtra } = extraMeta && typeof extraMeta === "object" ? extraMeta : {};
	const coverOriginal =
		extraOriginal !== undefined
			? extraOriginal
			: existingMeta.cover_original?.file_path
				? existingMeta.cover_original
				: snapshotCoverOriginal(image, existingMeta);
	const nextMeta = {
		...existingMeta,
		...restExtra,
		media_type: "audio",
		cover_source: coverSource,
	};
	if (coverOriginal) nextMeta.cover_original = coverOriginal;
	delete nextMeta.cover_placeholder;
	delete nextMeta.cover_generate;

	const updateResult = await queries.updateCreatedImageJobCompleted.run(image.id, image.user_id, {
		filename,
		file_path: filePath,
		width,
		height,
		color: image.color ?? null,
		meta: nextMeta,
	});
	if (!updateResult || updateResult.changes === 0) {
		const err = new Error("Failed to update cover");
		err.status = 500;
		throw err;
	}
	return { filename, file_path: filePath, width, height, meta: nextMeta };
}

export async function buildProceduralCoverForCreation(image, meta) {
	return buildProceduralAudioCoverBuffer({
		seed: seedAudioCoverFromCreation(image, meta),
		title: image?.title || "",
		kind: resolveAudioCoverKind(meta?.method || meta?.intent || "music"),
	});
}

async function bufferFromOriginalCover(storage, original) {
	const filename = typeof original?.filename === "string" ? original.filename.trim() : "";
	if (filename && typeof storage?.getImageBuffer === "function") {
		try {
			const buf = await storage.getImageBuffer(filename);
			if (Buffer.isBuffer(buf) && buf.length) return buf;
		} catch {
			// fall through to URL fetch
		}
	}
	const filePath = typeof original?.file_path === "string" ? original.file_path.trim() : "";
	if (!filePath) return null;
	const res = await fetch(filePath);
	if (!res.ok) return null;
	const buf = Buffer.from(await res.arrayBuffer());
	return buf.length ? buf : null;
}

export function parseAudioCoverSourceRef(raw) {
	const s = typeof raw === "string" ? raw.trim() : "";
	if (!s) return null;
	const creationId = parseCreationIdFromLink(s);
	if (creationId) return { kind: "creation", creationId };
	try {
		const parsed = new URL(s);
		if (parsed.protocol === "http:" || parsed.protocol === "https:") {
			return { kind: "url", url: parsed.toString() };
		}
	} catch {
		return null;
	}
	return null;
}

async function bufferFromStoredCreation(storage, row, fetchBuffer) {
	const filename = typeof row?.filename === "string" ? row.filename.trim() : "";
	if (filename && !filename.includes("..") && !filename.includes("/") && typeof storage?.getImageBuffer === "function") {
		try {
			const buf = await storage.getImageBuffer(filename);
			if (Buffer.isBuffer(buf) && buf.length) return buf;
		} catch {
			// fall through
		}
	}
	const fromPath = extractFilenameFromCreatedImagePath(row?.file_path);
	if (fromPath && typeof storage?.getImageBuffer === "function") {
		try {
			const buf = await storage.getImageBuffer(fromPath);
			if (Buffer.isBuffer(buf) && buf.length) return buf;
		} catch {
			// fall through to URL fetch
		}
	}
	const filePath = typeof row?.file_path === "string" ? row.file_path.trim() : "";
	if (filePath && typeof fetchBuffer === "function") {
		try {
			const parsed = new URL(filePath);
			if (parsed.protocol === "http:" || parsed.protocol === "https:") {
				return await fetchBuffer(filePath);
			}
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Resolve a pasted image URL or /creations/:id link into cover bytes.
 * @param {{ queries: object, storage: object, user: object, raw: string, fetchBuffer?: (url: string) => Promise<Buffer> }} params
 */
export async function bufferForAudioCoverSource({ queries, storage, user, raw, fetchBuffer }) {
	const ref = parseAudioCoverSourceRef(raw);
	if (!ref) {
		const err = new Error("Paste an image URL or a creation link");
		err.status = 400;
		throw err;
	}
	if (ref.kind === "creation") {
		const row = await queries.selectCreatedImageByIdAnyUser?.get(ref.creationId);
		if (!row) {
			const err = new Error("Creation not found");
			err.status = 404;
			throw err;
		}
		const isOwner = Number(row.user_id) === Number(user?.id);
		const published = row.published === true || row.published === 1;
		if (!isOwner && user?.role !== "admin" && !published) {
			const err = new Error("Creation not found");
			err.status = 404;
			throw err;
		}
		if (row.unavailable_at && !isOwner && user?.role !== "admin") {
			const err = new Error("Creation not found");
			err.status = 404;
			throw err;
		}
		const filePath = typeof row.file_path === "string" ? row.file_path.trim() : "";
		if (isPlaceholderAudioCover(filePath)) {
			const err = new Error("That creation does not have an image we can use as a cover");
			err.status = 400;
			throw err;
		}
		const stored = await bufferFromStoredCreation(storage, row, fetchBuffer);
		if (stored) return stored;
		const err = new Error("That creation does not have an image we can use as a cover");
		err.status = 400;
		throw err;
	}
	if (typeof fetchBuffer !== "function") {
		const err = new Error("Could not load that image URL");
		err.status = 400;
		throw err;
	}
	try {
		return await fetchBuffer(ref.url);
	} catch (cause) {
		const err = new Error(cause?.message || "Could not load that image URL");
		err.status = 400;
		throw err;
	}
}

export async function resetAudioCoverToOriginal({ queries, storage, image }) {
	const meta = parseCreationMeta(image.meta) || {};
	const original = meta.cover_original && typeof meta.cover_original === "object" ? meta.cover_original : null;
	if (original) {
		const stored = await bufferFromOriginalCover(storage, original).catch(() => null);
		if (stored) {
			const source = REAL_AUDIO_COVER_SOURCES.has(original.cover_source) ? original.cover_source : "procedural";
			return applyAudioCoverBuffer({
				queries,
				storage,
				image,
				buffer: stored,
				coverSource: source,
				extraMeta: { cover_original: original },
			});
		}
	}
	const built = await buildProceduralCoverForCreation(image, meta);
	return applyAudioCoverBuffer({
		queries,
		storage,
		image,
		buffer: built.buffer,
		coverSource: "procedural",
		extraMeta: { cover_original: original },
	});
}
