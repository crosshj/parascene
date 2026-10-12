import { getBaseAppUrl, getRequestHost, getShareHostname } from "../../services/create/url.js";

/**
 * On the share hostname: allow /s/*, /api/*, and /pages/*.
 * Other requests stay when a share page requested a subresource; document navigations redirect to the site.
 */
export function shareHostBoundary(req, res, next) {
	const host = getRequestHost(req);
	const shareHost = getShareHostname();
	if (host !== shareHost) return next();
	const path = (req.originalUrl || req.url || req.path || "").split("?")[0].replace(/^(?!\/)/, "/");
	if (path.startsWith("/s/") || path.startsWith("/api/") || path.startsWith("/pages/")) return next();
	const isDocumentNav = (req.get("sec-fetch-dest") || "").toLowerCase() === "document";
	let refererIsSharePage = false;
	const referer = req.get("referer");
	if (referer && typeof referer === "string") {
		try {
			const refUrl = new URL(referer);
			refererIsSharePage = refUrl.hostname.toLowerCase() === shareHost && refUrl.pathname.startsWith("/s/");
		} catch {
			// invalid referer
		}
	}
	if (refererIsSharePage && !isDocumentNav) return next();
	const pathAndQuery = (req.originalUrl || req.url || path || "/").replace(/^(?![/])/, "/");
	return res.redirect(302, `${getBaseAppUrl()}${pathAndQuery}`);
}
