import { getApiHostname, getBaseAppUrl, getRequestHost } from "../utils/url.js";

/** On API subdomain (e.g. api.parascene.com), only /api paths are allowed; other paths redirect to www. */
export function apiSubdomainRedirect(req, res, next) {
	const host = getRequestHost(req);
	const path = (req.path || req.originalUrl || "").split("?")[0];
	if (host === getApiHostname() && !path.startsWith("/api")) {
		const target = `${getBaseAppUrl()}${req.originalUrl || req.url || path}`;
		return res.redirect(302, target);
	}
	next();
}
