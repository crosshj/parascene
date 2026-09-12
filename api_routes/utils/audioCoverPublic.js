/** Public poster used when generated audio has no real cover art (same role as a video poster). */
export const PUBLIC_AUDIO_WAVEFORM_COVER_PATH = "/images/audio-cover-waveform.svg";

function audioImportProvider(meta) {
	const provider = meta?.import && typeof meta.import === "object" ? meta.import.provider : "";
	return typeof provider === "string" ? provider.trim().toLowerCase() : "";
}

/** Transparent PNG / old waveform SVG / audio stream — not album art. */
export function isPlaceholderAudioCover(path) {
	const trimmed = typeof path === "string" ? path.trim() : "";
	if (!trimmed) return false;
	const file = (trimmed.split(/[?#]/)[0] || "").toLowerCase();
	if (file.endsWith(".svg")) return true;
	if (file.includes("audio-cover")) return true;
	return /\/api\/create\/images\/\d+\/audio\/?$/.test(file);
}

/**
 * Video tiles work in chat because they have a poster URL that loads.
 * Generated audio stored a transparent PNG (or a private image URL that 404s in chat).
 * Point those covers at a public waveform poster instead.
 *
 * @param {string} mediaType
 * @param {object|null|undefined} meta
 * @param {string} existingUrl
 * @returns {string|null} public poster path, or null to keep existingUrl
 */
export function publicAudioWaveformCoverPath(mediaType, meta, existingUrl = "") {
	if (String(mediaType || "").trim().toLowerCase() !== "audio") return null;
	const provider = audioImportProvider(meta);
	if (provider === "youtube") return null;
	const existing = String(existingUrl || "").trim();
	if ((provider === "suno" || provider === "file") && existing && !isPlaceholderAudioCover(existing)) {
		return null;
	}
	if (meta?.cover_placeholder === true || isPlaceholderAudioCover(existing)) {
		return PUBLIC_AUDIO_WAVEFORM_COVER_PATH;
	}
	if (provider === "suno" || provider === "file") return null;
	return PUBLIC_AUDIO_WAVEFORM_COVER_PATH;
}
