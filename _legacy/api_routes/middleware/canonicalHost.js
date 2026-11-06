import { getBaseAppUrl, getRequestHost } from "../utils/url.js";

/** Canonical host: only https://www.parascene.com serves content. Apex and http redirect in one hop. */
const CANONICAL_HOST = "www.parascene.com";

export function canonicalHostRedirect(req, res, next) {
	const host = getRequestHost(req);
	const proto = (req.get("x-forwarded-proto") || (req.connection?.encrypted ? "https" : "http")).toLowerCase();
	const pathAndQuery = (req.originalUrl || req.url || req.path || "/").replace(/^(?!\/)/, "/");
	const isApex = host === "parascene.com";
	const isWwwHttp = host === CANONICAL_HOST && proto === "http";
	if (isApex || isWwwHttp) {
		const target = `${getBaseAppUrl()}${pathAndQuery}`;
		return res.redirect(301, target);
	}
	next();
}
