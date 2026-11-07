import { getCdnOrigin } from "../../services/create/url.js";

export function filesOriginForRequest(req) {
	const hostname = String(req?.hostname || "").toLowerCase();
	return hostname === "parascene.com" || hostname.endsWith(".parascene.com")
		? getCdnOrigin()
		: /^(?:localhost|127\.0\.0\.1|::1)$/.test(hostname) && req?.get?.("host")
			? `${req.protocol || "http"}://${req.get("host")}`
			: "";
}
