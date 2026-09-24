export function filesOriginForRequest(req) {
	const configured = String(process.env.FILES_ORIGIN || "").trim().replace(/\/$/, "");
	if (configured) return configured;
	const hostname = String(req?.hostname || "").toLowerCase();
	return hostname === "parascene.com" || hostname.endsWith(".parascene.com")
		? "https://cdn.parascene.com"
		: "";
}
