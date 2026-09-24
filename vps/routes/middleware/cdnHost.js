export function cdnHostname() {
	return String(process.env.CDN_HOSTNAME || "cdn.parascene.com").trim().toLowerCase();
}

export function isCdnRequest(req) {
	const host = String(req?.get?.("host") || "").trim().toLowerCase();
	return host.split(":")[0] === cdnHostname();
}

export function createCdnHostBoundary(cdnRouter) {
	return function cdnHostBoundary(req, res, next) {
		if (!isCdnRequest(req)) return next();
		return cdnRouter(req, res, next);
	};
}
