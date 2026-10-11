import { randomUUID } from "node:crypto";
import { getFeedBetaRedis } from "../feedBetaRedis.js";

/**
 * Per-scroll feed session: creation ids already served on this visit plus the
 * "from the past" keyset cursor once ranked pools stop filling pages.
 * Page 1 (open / refresh) starts a new session; page 2+ continues it.
 */
export const FEED_BETA_SESSION_KEY_PREFIX = 'feed-beta:session:';

/** Long enough for one browsing visit; a new visit starts fresh on page 1. */
export const FEED_BETA_SESSION_TTL_SEC = 2 * 60 * 60;

const SESSION_ID_RE = /^[0-9a-f-]{36}$/;

/** @param {number|string} userId @param {string} sessionId */
export function feedBetaSessionKey(userId, sessionId) {
	return `${FEED_BETA_SESSION_KEY_PREFIX}${String(userId)}:${sessionId}`;
}

export function isFeedBetaSessionStoreAvailable() {
	return Boolean(getFeedBetaRedis());
}

/** @param {string|null} [id] */
export function createFeedBetaSession(id = null) {
	return {
		id: id && SESSION_ID_RE.test(id) ? id : randomUUID(),
		served: new Set(),
		tail: null,
		tailExhausted: false
	};
}

/**
 * @param {unknown} raw
 * @param {string} id
 */
export function parseFeedBetaSession(raw, id) {
	let data = raw;
	if (typeof data === 'string') {
		try {
			data = JSON.parse(data);
		} catch {
			return null;
		}
	}
	if (!data || typeof data !== 'object') return null;
	const session = createFeedBetaSession(id);
	for (const key of Array.isArray(data.served) ? data.served : []) {
		const s = String(key ?? '').trim();
		if (s) session.served.add(s);
	}
	const tail = data.tail;
	if (tail && typeof tail === 'object' && tail.created_at && Number.isFinite(Number(tail.created_image_id))) {
		session.tail = { created_at: String(tail.created_at), created_image_id: Number(tail.created_image_id) };
	}
	session.tailExhausted = data.tail_exhausted === true;
	return session;
}

/**
 * Missing or expired sessions continue under the same id with an empty served set.
 * @param {number|string} userId
 * @param {string|null|undefined} sessionId
 */
export async function loadFeedBetaSession(userId, sessionId) {
	const id = String(sessionId ?? '').trim();
	const r = getFeedBetaRedis();
	if (!r || userId == null || !SESSION_ID_RE.test(id)) return createFeedBetaSession();
	try {
		const raw = await r.get(feedBetaSessionKey(userId, id));
		return parseFeedBetaSession(raw, id) ?? createFeedBetaSession(id);
	} catch (err) {
		console.warn('[feedBeta session] load', err?.message || err);
		return createFeedBetaSession(id);
	}
}

/**
 * @param {number|string} userId
 * @param {ReturnType<typeof createFeedBetaSession>} session
 */
export async function saveFeedBetaSession(userId, session) {
	const r = getFeedBetaRedis();
	if (!r || userId == null || !session?.id) return;
	const payload = JSON.stringify({
		served: [...session.served],
		tail: session.tail,
		tail_exhausted: session.tailExhausted === true
	});
	try {
		await r.set(feedBetaSessionKey(userId, session.id), payload, { ex: FEED_BETA_SESSION_TTL_SEC });
	} catch (err) {
		console.warn('[feedBeta session] save', err?.message || err);
	}
}
