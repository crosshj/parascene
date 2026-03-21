import { computeWelcome } from "../utils/welcome.js";

/** Paths that are allowed even when welcome is required (no redirect/block). */
const ALLOWED_PATHS = [
	{ path: "/welcome", method: "GET" },
	{ path: "/api/profile", methods: ["GET", "PUT", "POST", "PATCH"] },
	{ path: "/api/profile/api-key", methods: ["POST", "DELETE"] },
	{ path: "/api/account/email", methods: ["PUT"] },
	{ path: "/api/username-suggest", methods: ["GET"] },
	{ path: "/api/policy/seen", methods: ["POST"] },
	{ path: "/api/try/create", methods: ["POST"] },
	{ path: "/api/try/list", methods: ["GET"] },
	{ path: "/api/try/discard", methods: ["POST"] },
	{ pathPrefix: "/api/try/images/", method: "GET" },
	{ path: "/api/qr", methods: ["GET"] },
	{ path: "/logout", methods: ["POST"] },
	{ path: "/auth.html", methods: ["GET"] },
	{ path: "/me", methods: ["GET"] }
];

function isAllowed(method, pathName) {
	const m = String(method || "GET").toUpperCase();
	const p = String(pathName || "");
	for (const rule of ALLOWED_PATHS) {
		if (rule.pathPrefix && p.startsWith(rule.pathPrefix) && (rule.method === undefined || m === rule.method)) return true;
		if (rule.path !== p) continue;
		if (rule.methods && rule.methods.includes(m)) return true;
		if (rule.method && m === rule.method) return true;
	}
	return false;
}

/**
 * Block most authenticated actions until user has completed welcome (profile/username etc).
 * Fail-open on errors to avoid hard-locking the app.
 */
export function createWelcomeGate(queries) {
	return async function welcomeGate(req, res, next) {
		const userId = req.auth?.userId;
		if (!userId) return next();

		try {
			const method = String(req.method || "GET").toUpperCase();
			const pathName = String(req.path || "");
			if (isAllowed(method, pathName)) return next();

			const profileRow = await queries.selectUserProfileByUserId?.get(userId);
			const welcome = computeWelcome({ profileRow });
			if (!welcome.required) return next();

			if (pathName.startsWith("/api/")) {
				return res.status(409).json({ error: "WELCOME_REQUIRED", welcome });
			}
			return res.redirect("/welcome");
		} catch {
			return next();
		}
	};
}
