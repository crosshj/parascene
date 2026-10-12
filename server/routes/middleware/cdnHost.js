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

function requestHostname(req) {
	return String(req?.get?.("host") || "").trim().toLowerCase().split(":")[0];
}

export function isCdnRequest(req) {
	return cdnHostnames().has(requestHostname(req));
}

function isLoopbackHost(req) {
	const host = requestHostname(req);
	return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function createCdnHostBoundary(cdnRouter) {
	return function cdnHostBoundary(req, res, next) {
		const filesPath = /^(\/api\/files(?:\/|$)|\/api\/images\/generic(?:\/|$)|\/s\/)/.test(String(req.path || ""));
		// Localhost serves My Files even when NODE_ENV is production. Other hosts
		// only get these routes on the CDN hostname.
		const localFiles = filesPath && (process.env.NODE_ENV !== "production" || isLoopbackHost(req));
		if (!isCdnRequest(req) && !localFiles) return next();
		return cdnRouter(req, res, next);
	};
}
