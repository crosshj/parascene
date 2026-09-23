import { COOKIE_NAME, clearSessionCookie, hashToken, readToken } from "../utils/session.js";

export function createAuthMiddleware(db) {
	return async (req, res, next) => {
		const token = req.cookies?.[COOKIE_NAME];
		const userId = token ? readToken(token) : null;
		if (!token || !userId) return next();
		try {
			const session = await db.sessionByToken(hashToken(token), userId);
			// Match the current app: a valid JWT remains usable if the session row
			// is missing (for example, if session persistence failed during login).
			// JWT expiry still limits the fallback's lifetime.
			if (session && new Date(session.expires_at).getTime() <= Date.now()) { clearSessionCookie(res); return next(); }
			req.auth = { userId, token };
			return next();
		} catch (error) { return next(error); }
	};
}
export function requireAuth(req, res, next) { if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized", message: "Not signed in" }); next(); }
