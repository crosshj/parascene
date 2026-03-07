import path from "path";
import { clearAuthCookie, COOKIE_NAME } from "../auth.js";
import { injectCommonHead, getPageTokens } from "../utils/head.js";

/**
 * Handle UnauthorizedError: clear cookie if present, then either send 401 JSON (for API/me)
 * or redirect to auth (for pages). If already on /auth.html, serve the auth page HTML.
 */
export function createUnauthorizedHandler(pagesDir) {
	return async function unauthorizedHandler(err, req, res, next) {
		if (err?.name !== "UnauthorizedError") return next(err);

		console.log("[ErrorHandler] UnauthorizedError", {
			path: req.path,
			originalUrl: req.originalUrl,
			hasCookie: !!req.cookies?.[COOKIE_NAME],
			error: err.message
		});

		if (req.cookies?.[COOKIE_NAME]) {
			clearAuthCookie(res, req);
		}

		if (req.path.startsWith("/api/") || req.path === "/me") {
			return res.status(401).json({ error: "Unauthorized" });
		}

		if (req.path === "/auth.html") {
			const fs = await import("fs/promises");
			let htmlContent = await fs.readFile(path.join(pagesDir, "auth.html"), "utf-8");
			htmlContent = injectCommonHead(htmlContent, getPageTokens(req));
			res.setHeader("Content-Type", "text/html");
			return res.send(htmlContent);
		}

		const rawReturnUrl = typeof req.originalUrl === "string" ? req.originalUrl : "/";
		const returnUrl =
			rawReturnUrl.startsWith("/") && !rawReturnUrl.startsWith("//") && !rawReturnUrl.includes("://")
				? rawReturnUrl
				: "/";
		try {
			return res.redirect(`/auth.html?returnUrl=${encodeURIComponent(returnUrl)}`);
		} catch {
			const fs = await import("fs/promises");
			let htmlContent = await fs.readFile(path.join(pagesDir, "auth.html"), "utf-8");
			htmlContent = injectCommonHead(htmlContent, getPageTokens(req));
			res.setHeader("Content-Type", "text/html");
			return res.send(htmlContent);
		}
	};
}
