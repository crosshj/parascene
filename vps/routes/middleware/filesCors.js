function allowedOrigins() {
	const configured = String(process.env.FILES_ALLOWED_ORIGINS || "")
		.split(",")
		.map((value) => value.trim().replace(/\/$/, ""))
		.filter(Boolean);
	return new Set(configured.length ? configured : ["https://beta.parascene.com", "https://www.parascene.com"]);
}

export function createFilesCors() {
	const origins = allowedOrigins();
	return function filesCors(req, res, next) {
		const origin = String(req.get("origin") || "").replace(/\/$/, "");
		if (origin && !origins.has(origin)) {
			return res.status(403).json({ error: "Forbidden", message: "Origin is not allowed" });
		}
		if (origin) {
			res.set("Access-Control-Allow-Origin", origin);
			res.set("Access-Control-Allow-Credentials", "true");
			res.vary("Origin");
		}
		if (req.method === "OPTIONS") {
			res.set("Access-Control-Allow-Methods", "GET, HEAD, POST, DELETE, OPTIONS");
			res.set("Access-Control-Allow-Headers", "Content-Type, Range, X-upload-kind, X-upload-name, X-upload-aspect-ratio");
			res.set("Access-Control-Max-Age", "600");
			return res.sendStatus(204);
		}
		return next();
	};
}
