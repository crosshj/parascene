import { COOKIE_NAME, clearSessionCookie, hashToken, readToken } from "../utils/session.js";

function tokenUserIdHint(token) {
	try {
		const payload = JSON.parse(Buffer.from(String(token).split(".")[1] || "", "base64url").toString("utf8"));
		const userId = Number(payload?.userId);
		return Number.isInteger(userId) && userId > 0 ? userId : null;
	} catch {
		return null;
	}
}

export function createAuthMiddleware(sessions, users) {
	return async (req, res, next) => {
		const token = req.cookies?.[COOKIE_NAME];
		const userId = token ? readToken(token) : null;
		if (!token) return next();
		if (!userId) {
			const staleUserId = tokenUserIdHint(token);
			if (staleUserId) users?.invalidateCache?.(staleUserId);
			clearSessionCookie(res, req);
			return next();
		}
		try {
			const session = await sessions.byToken(hashToken(token), userId);
			// Match the current app: a valid JWT remains usable if the session row
			// is missing (for example, if session persistence failed during login).
			// JWT expiry still limits the fallback's lifetime.
			if (session && new Date(session.expires_at).getTime() <= Date.now()) {
				users?.invalidateCache?.(userId);
				clearSessionCookie(res, req);
				return next();
			}
			req.auth = { userId, token };
			return next();
		} catch (error) { return next(error); }
	};
}
export function requireAuth(req, res, next) { if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized", message: "Not signed in" }); next(); }
