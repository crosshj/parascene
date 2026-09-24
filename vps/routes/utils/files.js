import path from "node:path";

const SAFE_INLINE_TYPES = /^(?:image\/(?:avif|gif|jpeg|png|webp)|audio\/(?:mpeg|mp4|ogg|wav|webm)|video\/(?:mp4|ogg|quicktime|webm))$/i;

const CONTENT_TYPES = new Map([
	[".avif", "image/avif"],
	[".gif", "image/gif"],
	[".jpeg", "image/jpeg"],
	[".jpg", "image/jpeg"],
	[".png", "image/png"],
	[".webp", "image/webp"],
	[".mp3", "audio/mpeg"],
	[".m4a", "audio/mp4"],
	[".ogg", "audio/ogg"],
	[".wav", "audio/wav"],
	[".mp4", "video/mp4"],
	[".mov", "video/quicktime"],
	[".webm", "video/webm"],
	[".pdf", "application/pdf"],
	[".txt", "text/plain; charset=utf-8"],
	[".zip", "application/zip"]
]);

export function normalizeFileId(value) {
	const id = String(value || "").trim();
	if (!id || id === "." || id === ".." || id.length > 255) return null;
	if (id.includes("/") || id.includes("\\") || id.includes("\0") || id.includes("..")) return null;
	if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) return null;
	return id;
}

export function contentTypeForFile(file) {
	const fromMetadata = String(file?.metadata?.mimetype || file?.metadata?.contentType || "").trim();
	if (fromMetadata) return fromMetadata;
	return CONTENT_TYPES.get(path.extname(String(file?.name || "")).toLowerCase()) || "application/octet-stream";
}

export function serializeFile(file) {
	const id = normalizeFileId(file?.name);
	if (!id) return null;
	const size = Number(file?.metadata?.size);
	return {
		id,
		display_name: null,
		content_type: contentTypeForFile(file),
		size: Number.isFinite(size) && size >= 0 ? size : null,
		created_at: file?.created_at || null,
		updated_at: file?.updated_at || null,
		content_path: `/api/files/${encodeURIComponent(id)}/content`
	};
}

export function mayDisplayInline(contentType) {
	return SAFE_INLINE_TYPES.test(String(contentType || "").split(";")[0].trim());
}

export function safeDispositionFilename(fileId) {
	return String(fileId || "file").replace(/["\\\r\n]/g, "_");
}
