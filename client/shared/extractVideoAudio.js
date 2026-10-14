const MIME_CANDIDATES = [
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/ogg;codecs=opus',
	'audio/mp4',
];

/**
 * Mime type for a microphone recording. Video audio is extracted on the server.
 * @returns {string}
 */
export function pickAudioRecorderMimeType() {
	if (typeof MediaRecorder === 'undefined') return '';
	for (const mime of MIME_CANDIDATES) {
		if (MediaRecorder.isTypeSupported(mime)) return mime;
	}
	return '';
}
