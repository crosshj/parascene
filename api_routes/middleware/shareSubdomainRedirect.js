import { getBaseAppUrl, getRequestHost, SHARE_HOSTNAME } from "../utils/url.js";

/**
 * On share subdomain (sh.parascene.com): allow /s/*, /api/*, /pages/*.
 * Other requests: allow if Referer is share page and Sec-Fetch-Dest is not "document"; else redirect to www.
 */
export function shareSubdomainRedirect(req, res, next) {
	const host = getRequestHost(req);
	if (host !== SHARE_HOSTNAME) return next();
	const path = (req.originalUrl || req.url || req.path || "").split("?")[0].replace(/^(?!\/)/, "/");
	if (path.startsWith("/s/") || path.startsWith("/api/") || path.startsWith("/pages/")) return next();
	const isDocumentNav = (req.get("sec-fetch-dest") || "").toLowerCase() === "document";
	let refererIsSharePage = false;
	const referer = req.get("referer");
	if (referer && typeof referer === "string") {
		try {
			const refUrl = new URL(referer);
			refererIsSharePage = refUrl.hostname.toLowerCase() === SHARE_HOSTNAME && refUrl.pathname.startsWith("/s/");
		} catch {
			// invalid referer
		}
	}
	if (refererIsSharePage && !isDocumentNav) return next();
	const pathAndQuery = (req.originalUrl || req.url || path || "/").replace(/^(?![/])/, "/");
	return res.redirect(302, `${getBaseAppUrl()}${pathAndQuery}`);
}
