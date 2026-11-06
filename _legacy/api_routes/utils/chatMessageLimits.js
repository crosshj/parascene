/**
 * Chat message body size limits.
 * Normal chat stays small; #challenges machine configs may be larger.
 */

export const MAX_CHAT_MESSAGE_CHARS = 4000;

/** Absolute ceiling for challenge_config / challenges_global_config in #challenges. */
export const MAX_MACHINE_CHANNEL_MESSAGE_CHARS = 65536;

const MACHINE_CHANNEL_CONFIG_KINDS = new Set([
	'challenge_config',
	'challenges_global_config'
]);

/**
 * @param {object | null | undefined} threadRow
 */
export function isChallengesChannelThread(threadRow) {
	return (
		threadRow?.type === 'channel' &&
		String(threadRow?.channel_slug || '')
			.trim()
			.toLowerCase() === 'challenges'
	);
}

/**
 * @param {string} body
 * @param {(body: string) => object | null} [parseJson]
 */
export function chatMessageBodyKind(body, parseJson) {
	if (typeof parseJson === 'function') {
		const parsed = parseJson(body);
		return parsed && typeof parsed === 'object'
			? String(parsed.kind || '').trim()
			: '';
	}
	const s = String(body || '').trim();
	if (!s.startsWith('{')) return '';
	try {
		const o = JSON.parse(s);
		return o && typeof o === 'object' && !Array.isArray(o)
			? String(o.kind || '').trim()
			: '';
	} catch {
		return '';
	}
}

/**
 * @param {object | null | undefined} threadRow
 * @param {string} body
 * @param {(body: string) => object | null} [parseJson]
 */
export function maxChatMessageBodyChars(threadRow, body, parseJson) {
	if (!isChallengesChannelThread(threadRow)) return MAX_CHAT_MESSAGE_CHARS;
	const kind = chatMessageBodyKind(body, parseJson);
	if (MACHINE_CHANNEL_CONFIG_KINDS.has(kind)) return MAX_MACHINE_CHANNEL_MESSAGE_CHARS;
	return MAX_CHAT_MESSAGE_CHARS;
}
