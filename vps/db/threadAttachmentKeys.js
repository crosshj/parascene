/**
 * Chat uploads use `profile/{userId}/generic_*` (image/video) and
 * `profile/{userId}/misc_*` (other file types).
 */

export function safeDecodeGenericImageKeyTail(encodedTail) {
	try {
		const key = String(encodedTail || "")
			.split("/")
			.filter(Boolean)
			.map((s) => decodeURIComponent(s))
			.join("/");
		if (!key || key.includes("..")) return null;
		return key;
	} catch {
		return null;
	}
}

/** True if key is a chat misc upload path owned by `userId`. */
export function isChatMiscGenericKeyOwnedByUser(key, userId) {
	const uid = Number(userId);
	if (!Number.isFinite(uid) || uid <= 0) return false;
	const m = String(key || "").match(/^profile\/(\d+)\/((?:generic|misc)_[^/]+)$/i);
	if (!m) return false;
	return Number(m[1]) === uid;
}

/**
 * Unique `profile/…/(generic_*|misc_*)` keys referenced in message text
 * (relative or absolute URLs).
 */
export function collectChatMiscGenericKeysFromMessageBody(text) {
	const keys = new Set();
	const t = String(text || "");
	const re = /(?:https?:\/\/[^\s"'<>]+)?\/api\/images\/generic\/([^\s"'<>]+)/gi;
	let m;
	while ((m = re.exec(t)) !== null) {
		let tail = m[1];
		const q = tail.indexOf("?");
		if (q >= 0) tail = tail.slice(0, q);
		tail = tail.replace(/[.,!?:;")\]]+$/g, "").trim();
		const key = safeDecodeGenericImageKeyTail(tail);
		if (key && /^profile\/\d+\/(?:generic|misc)_[^/]+$/i.test(key)) keys.add(key);
	}
	return [...keys];
}
