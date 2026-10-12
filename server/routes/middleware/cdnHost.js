export function cdnHostname() {
	return String(process.env.CDN_HOSTNAME || "cdn.parascene.com").trim().toLowerCase().split(":")[0];
}

/** Primary media host plus aliases that must keep the CDN route boundary. */
export function cdnHostnames() {
	const aliases = String(process.env.CDN_HOST_ALIASES || "")
		.split(",")
		.map((value) => value.trim().toLowerCase().split(":")[0])
		.filter(Boolean);
	return new Set([cdnHostname(), ...aliases]);
}

export function isCdnRequest(req) {
	const host = String(req?.get?.("host") || "").trim().toLowerCase().split(":")[0];
	return cdnHostnames().has(host);
}

export function createCdnHostBoundary(cdnRouter) {
	return function cdnHostBoundary(req, res, next) {
		const localDev = process.env.NODE_ENV !== "production" && /^(\/api\/files(?:\/|$)|\/api\/images\/generic(?:\/|$)|\/s\/)/.test(String(req.path || ""));
		if (!isCdnRequest(req) && !localDev) return next();
		return cdnRouter(req, res, next);
	};
}
