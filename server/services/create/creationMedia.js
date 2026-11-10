import { parseCreationMeta } from "./resolveCreatedImageStorageFilename.js";

/** True when creation metadata identifies a video, including older video rows. */
export function creationRowIsVideo(metaRaw) {
	const meta = parseCreationMeta(metaRaw);
	if (!meta || typeof meta !== "object") return false;
	if (meta.media_type === "video") return true;
	if (meta.video && typeof meta.video === "object") return true;
	const path = typeof meta.file_path === "string" ? meta.file_path.trim() : "";
	if (path.startsWith("/api/videos/created/")) return true;
	const filename = typeof meta.video_filename === "string" ? meta.video_filename : "";
	return filename.startsWith("video/");
}
