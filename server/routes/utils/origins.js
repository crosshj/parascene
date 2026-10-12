import { getCdnHostname, getCdnOrigin, getShareHostname } from "../../services/create/url.js";

function isShareHostname(hostname) {
	const host = String(hostname || "").toLowerCase();
	return host === getShareHostname() || host === "sh.parascene.com";
}

export function filesOriginForRequest(req) {
	const configured = String(process.env.FILES_ORIGIN || "").trim().replace(/\/$/, "");
	if (configured) {
		const origin = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
		try {
			const url = new URL(origin);
			// /s on the share host serves creation shares. Signed My Files links
			// use the same path shape but are served by the CDN service.
			if (isShareHostname(url.hostname)) url.hostname = getCdnHostname();
			return url.origin;
		} catch {
			return origin;
		}
	}
	const hostname = String(req?.hostname || "").toLowerCase();
	return hostname === "parascene.com" || hostname.endsWith(".parascene.com")
		? getCdnOrigin()
		: /^(?:localhost|127\.0\.0\.1|::1)$/.test(hostname) && req?.get?.("host")
			? `${req.protocol || "http"}://${req.get("host")}`
			: "";
}
