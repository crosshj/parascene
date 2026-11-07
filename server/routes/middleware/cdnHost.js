import { getCdnHostname } from "../../services/create/url.js";

export function cdnHostname() {
	return getCdnHostname();
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
		const path = String(req.path || "");
		const filesPath = /^(\/api\/files(?:\/|$)|\/api\/images\/generic(?:\/|$)|\/s\/)/.test(path);
		const cdnPath = filesPath || path === "/healthz";
		const betaManualHost = process.env.APP_VERSION === "beta" && requestHostname(req) === "beta-cdn.parascene.com";
		// Localhost serves My Files even when NODE_ENV is production. Other hosts
		// only get these routes on the canonical CDN host (or beta for manual tests).
		const localFiles = cdnPath && (process.env.NODE_ENV !== "production" || isLoopbackHost(req));
		if (!isCdnRequest(req) && !localFiles && !(cdnPath && betaManualHost)) return next();
		return cdnRouter(req, res, next);
	};
}
