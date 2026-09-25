export function filesOriginForRequest(req) {
	const configured = String(process.env.FILES_ORIGIN || "").trim().replace(/\/$/, "");
	if (configured) return /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
	const hostname = String(req?.hostname || "").toLowerCase();
	return hostname === "parascene.com" || hostname.endsWith(".parascene.com")
		? "https://cdn.parascene.com"
		: /^(?:localhost|127\.0\.0\.1|::1)$/.test(hostname) && req?.get?.("host")
			? `${req.protocol || "http"}://${req.get("host")}`
			: "";
}
