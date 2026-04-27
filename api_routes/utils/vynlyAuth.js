/**
 * Bearer token for Vynly API calls: stored on the signed-in user in `users.meta.vynlyBearerToken`
 * (set via Profile modal). No env fallback — configure per user for production (e.g. Vercel).
 *
 * @param {{ id?: number, meta?: object | null }} user - From `selectUserById` (includes parsed meta)
 * @returns {string | null}
 */
export function getVynlyBearerToken({ user }) {
	if (!user || typeof user !== "object") return null;
	const meta = user.meta && typeof user.meta === "object" ? user.meta : {};
	const raw = typeof meta.vynlyBearerToken === "string" ? meta.vynlyBearerToken.trim() : "";
	return raw.length > 0 ? raw : null;
}

/**
 * @param {{ id?: number, meta?: object | null }} user
 * @returns {boolean}
 */
export function isVynlyConfiguredForUser(user) {
	return !!getVynlyBearerToken({ user });
}
