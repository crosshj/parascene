/** Channel message pin (one per channel): `prsn_chat_threads.meta.channel_pin.message_id`. */

const CHANNEL_MESSAGE_PIN_ALLOWLIST_USERNAMES = new Set(['oceanman']);

export function getChannelPinnedMessageIdFromThreadRow(threadRow) {
	if (!threadRow || typeof threadRow !== 'object') return null;
	const m = threadRow.meta;
	if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
	const pin = m.channel_pin;
	if (!pin || typeof pin !== 'object' || Array.isArray(pin)) return null;
	const id = pin.message_id ?? pin.messageId;
	const n = id != null ? Number(id) : null;
	return Number.isFinite(n) && n > 0 ? n : null;
}

export function buildThreadMetaWithChannelPin(prevMeta, pinnedMessageIdOrNull, pinnedByUserId) {
	const prev =
		prevMeta && typeof prevMeta === 'object' && !Array.isArray(prevMeta) ? { ...prevMeta } : {};
	if (pinnedMessageIdOrNull == null) {
		delete prev.channel_pin;
		return prev;
	}
	const pin = {
		message_id: pinnedMessageIdOrNull,
		pinned_at: new Date().toISOString()
	};
	const by = pinnedByUserId != null ? Number(pinnedByUserId) : null;
	if (Number.isFinite(by) && by > 0) pin.pinned_by = by;
	prev.channel_pin = pin;
	return prev;
}

export function getPinnedCanvasMessageIdFromThreadRow(threadRow) {
	if (!threadRow || typeof threadRow !== 'object') return null;
	const m = threadRow.meta;
	if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
	const canvas = m.canvas;
	if (!canvas || typeof canvas !== 'object' || Array.isArray(canvas)) return null;
	const id = canvas.pinned_message_id ?? canvas.pinnedMessageId;
	const n = id != null ? Number(id) : null;
	return Number.isFinite(n) && n > 0 ? n : null;
}

export function isSystemEventMessageRow(msg) {
	const meta = msg?.meta;
	if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false;
	const ev = meta.system_event;
	return Boolean(ev && typeof ev === 'object' && !Array.isArray(ev));
}

export function isCanvasMessageRow(msg) {
	const meta = msg?.meta;
	if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false;
	const canvas = meta.canvas;
	if (!canvas || typeof canvas !== 'object') return false;
	const title = typeof canvas.title === 'string' ? canvas.title.trim() : '';
	return title.length > 0;
}

/**
 * @param {{ role?: string }} [viewer]
 * @param {{ user_name?: string | null }} [profile]
 */
export function viewerCanPinChannelMessages(viewer, profile) {
	if (viewer?.role === 'admin') return true;
	const un = typeof profile?.user_name === 'string' ? profile.user_name.trim().toLowerCase() : '';
	return un.length > 0 && CHANNEL_MESSAGE_PIN_ALLOWLIST_USERNAMES.has(un);
}
