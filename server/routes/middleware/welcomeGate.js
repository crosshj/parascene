import { computeWelcome } from "../../services/account/welcome.js";

/** Paths that stay available until welcome is finished. */
const ALLOWED_PATHS = [
	{ pathPrefix: "/images/", method: "GET" },
	{ pathPrefix: "/icons/", method: "GET" },
	{ pathPrefix: "/audio/", method: "GET" },
	{ pathPrefix: "/welcome/", method: "GET" },
	{ pathPrefix: "/api/try/images/", method: "GET" },
	{ path: "/welcome", method: "GET" },
	{ path: "/typography.css", method: "GET" },
	{ path: "/favicon.svg", method: "GET" },
	{ path: "/favicon.ico", method: "GET" },
	{ path: "/auth/auth.css", method: "GET" },
	{ path: "/api/profile", methods: ["GET", "PUT", "POST", "PATCH"] },
	{ path: "/api/profile/api-key", methods: ["POST", "DELETE"] },
	{ path: "/api/account/email", methods: ["PUT"] },
	{ path: "/api/auth/session", methods: ["GET"] },
	{ path: "/api/auth/logout", methods: ["POST"] },
	{ path: "/api/styles/names", methods: ["GET"] },
	{ path: "/api/users/usernames", methods: ["GET"] },
	{ path: "/api/username-suggest", methods: ["GET"] },
	{ path: "/api/policy/seen", methods: ["POST"] },
	{ path: "/api/try/create", methods: ["POST"] },
	{ path: "/api/try/list", methods: ["GET"] },
	{ path: "/api/try/discard", methods: ["POST"] },
	{ path: "/api/qr", methods: ["GET"] },
	{ pathPrefix: "/api/kiosk/", method: "GET" },
	{ path: "/logout", methods: ["POST"] },
	{ path: "/auth", methods: ["GET"] },
	{ path: "/auth.html", methods: ["GET"] },
	{ path: "/me", methods: ["GET"] },
	{ path: "/oauth/token", methods: ["POST"] },
	{ path: "/oauth/userinfo", method: "GET" },
	{ path: "/oauth/authorize", method: "GET" },
	{ path: "/oauth/authorize/continue", methods: ["POST"] },
	{ path: "/integrations", method: "GET" }
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

function welcomeRedirect(req) {
	const raw = String(req.originalUrl || req.path || "/");
	if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("://") || /[\r\n]/.test(raw)) return "/welcome";
	const pathOnly = raw.split("?")[0].replace(/\/+$/, "") || "/";
	if (pathOnly === "/" || pathOnly === "/welcome" || pathOnly === "/auth" || pathOnly === "/auth.html") return "/welcome";
	return `/welcome?returnUrl=${encodeURIComponent(raw.slice(0, 2048))}`;
}

/**
 * Block authenticated use until the account has a username.
 * Fail-open on lookup errors so a storage blip cannot lock the app.
 */
export function createWelcomeGate(queries) {
	return async function welcomeGate(req, res, next) {
		const userId = req.auth?.userId;
		if (!userId) return next();

		try {
			const method = String(req.method || "GET").toUpperCase();
			const pathName = String(req.path || "");
			if (isAllowed(method, pathName)) return next();

			const user = await queries.selectUserById?.get?.(userId);
			if (user?.role === "admin") return next();

			const profileRow = await queries.selectUserProfileByUserId?.get?.(userId);
			const welcome = computeWelcome({ profileRow });
			if (!welcome.required) return next();

			if (pathName.startsWith("/api/")) {
				return res.status(409).json({ error: "WELCOME_REQUIRED", welcome });
			}
			return res.redirect(welcomeRedirect(req));
		} catch {
			return next();
		}
	};
}
