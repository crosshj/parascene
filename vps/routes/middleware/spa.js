import fs from "node:fs/promises";

function isDocumentRequest(req) {
	if (req.method !== "GET") return false;
	if (!String(req.headers.accept || "").includes("text/html")) return false;
	const pathname = String(req.path || "");
	if (pathname.startsWith("/api/") || pathname.startsWith("/assets/")) return false;
	return !/\/[^/]*\.[^/]+$/.test(pathname);
}

function loginUrlFor(req) {
	const returnUrl = req.originalUrl || req.path || "/";
	return `/auth?returnUrl=${encodeURIComponent(returnUrl)}#login`;
}

/** Fall back authenticated document navigations to the client-side app shell. */
export function createSpaFallback({ appPagePath }) {
	return async function spaFallback(req, res, next) {
		if (!isDocumentRequest(req)) return next();
		if (!req.auth?.userId) return res.redirect(loginUrlFor(req));
		try {
			const html = await fs.readFile(appPagePath, "utf8");
			return res.type("html").send(html);
		} catch (error) {
			return next(error);
		}
	};
}
