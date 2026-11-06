import { shouldSkipSessionRefresh } from "../auth.js";
import { getClientIdFromRequest } from "../utils/prsnCids.js";
import { appendPrsnCidsForUserId } from "../utils/userPrsnCids.js";

/**
 * Re-sync same browser at most this often (picks up new try_requests rows for same ps_cid).
 * Matches the ~15m window used for `users.last_active_at` updates in sessionMiddleware.
 */
const SAME_CLIENT_RESYNC_MS = 15 * 60 * 1000;

const lastClientIdByUser = new Map();
const lastSyncAtByUser = new Map();

/**
 * Runs after `authMiddleware` + `sessionMiddleware` (order in api/index.js).
 *
 * Auth/session recap:
 * - `authMiddleware`: JWT from `ps_session` cookie → `req.auth.userId` (no DB).
 * - `sessionMiddleware`: validates session row, `updateUserLastActive` (throttled in SQL to ~15m),
 *   may refresh session expiry near token end — already one DB read per authed request.
 *
 * This middleware only schedules `appendPrsnCidsForUserId` when:
 * - Request is not skipped by `shouldSkipSessionRefresh` (same paths where we skip session *expiry refresh*:
 *   static assets, common file extensions, etc.) — avoids extra profile reads on image/CSS/JS hits.
 * - `prsn_cid` cookie is present.
 * - First time we see this user+client id, or periodic resync (15m), or client id changed (new browser).
 *
 * `appendPrsnCidsForUserId` itself does SELECT profile + upsert only when `meta.prsn_cids` would change.
 *
 * Login/signup and profile PUT/POST still merge client ids in their handlers; this covers long-lived sessions.
 *
 * @param {object} queries
 */
export function createPrsnCidPersistMiddleware(queries) {
	return function prsnCidPersistMiddleware(req, res, next) {
		const uid = req.auth?.userId;
		if (!uid) return next();

		if (req.method === "OPTIONS") {
			return next();
		}

		if (shouldSkipSessionRefresh(req)) {
			return next();
		}

		const cid = getClientIdFromRequest(req);
		if (!cid) return next();

		const prev = lastClientIdByUser.get(uid);
		const now = Date.now();
		const lastAt = lastSyncAtByUser.get(uid) || 0;
		const clientChanged = prev !== cid;
		const duePeriodic = now - lastAt >= SAME_CLIENT_RESYNC_MS;

		if (!clientChanged && !duePeriodic) return next();

		lastClientIdByUser.set(uid, cid);
		lastSyncAtByUser.set(uid, now);
		appendPrsnCidsForUserId(queries, uid, req).catch(() => {});
		return next();
	};
}
