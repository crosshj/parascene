export function filesOriginForRequest(req) {
	const configured = String(process.env.FILES_ORIGIN || "").trim().replace(/\/$/, "");
	if (configured) {
		const origin = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
		try {
			const url = new URL(origin);
			// /s on sh.parascene.com serves creation shares. Signed My Files links
			// use the same path shape but are served by the CDN service.
			if (url.hostname.toLowerCase() === "sh.parascene.com") url.hostname = "cdn.parascene.com";
			return url.origin;
		} catch {
			return origin;
		}
	}
	const hostname = String(req?.hostname || "").toLowerCase();
	return hostname === "parascene.com" || hostname.endsWith(".parascene.com")
		? "https://cdn.parascene.com"
		: /^(?:localhost|127\.0\.0\.1|::1)$/.test(hostname) && req?.get?.("host")
			? `${req.protocol || "http"}://${req.get("host")}`
			: "";
}
