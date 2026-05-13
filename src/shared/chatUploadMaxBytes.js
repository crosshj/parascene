/**
 * Max bytes for chat composer attachments (`POST /api/images/generic`, My Notes, etc.).
 * Must match `express.raw` limit in `api_routes/images.js`.
 */
export const CHAT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

/** User-facing limit string, e.g. "50MB" (binary MiB, rounded). */
export function chatUploadMaxSizeLabel() {
	return `${Math.round(CHAT_UPLOAD_MAX_BYTES / (1024 * 1024))}MB`;
}
