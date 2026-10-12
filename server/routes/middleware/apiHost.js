import { getApiHostname, getBaseAppUrl, getRequestHost } from "../../services/create/url.js";

/** On the API hostname, only /api paths are served. Everything else redirects to the site origin. */
export function apiHostBoundary(req, res, next) {
	const host = getRequestHost(req);
	const path = (req.path || req.originalUrl || "").split("?")[0];
	if (host === getApiHostname() && !path.startsWith("/api")) {
		const target = `${getBaseAppUrl()}${req.originalUrl || req.url || path}`;
		return res.redirect(302, target);
	}
	next();
}
