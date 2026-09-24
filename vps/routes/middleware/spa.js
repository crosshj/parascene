import fs from "node:fs/promises";
import { getAppAssetNames } from "../utils/appAssets.js";
import { filesOriginForRequest } from "../utils/origins.js";

function serializeBootstrap(value) {
	return JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll(">", "\\u003e")
		.replaceAll("&", "\\u0026")
		.replaceAll("/", "\\u002f");
}

async function bootstrapForRequest(req, users) {
	const user = req.auth?.userId ? await users?.byId(req.auth.userId) : null;
	const profile = req.auth?.userId ? await users?.profileByUserId(req.auth.userId) : null;
	return {
		user: user ? { ...user, profile: profile || null } : null,
		clientRoute: req.originalUrl || req.path || "/",
		filesOrigin: filesOriginForRequest(req)
	};
}

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
export function createSpaFallback({ appPagePath, users, buildDir }) {
	return async function spaFallback(req, res, next) {
		if (!isDocumentRequest(req)) return next();
		if (!req.auth?.userId) return res.redirect(loginUrlFor(req));
		try {
			let html = await fs.readFile(appPagePath, "utf8");
			if (html.includes("{{APP_BOOTSTRAP}}")) {
				html = html.replace("{{APP_BOOTSTRAP}}", `<script>window.__PARASCENE_BOOTSTRAP__=${serializeBootstrap(await bootstrapForRequest(req, users))};</script>`);
			}
			if (html.includes("{{APP_JS}}") || html.includes("{{APP_CSS}}")) {
				const assets = await getAppAssetNames(buildDir);
				html = html.replaceAll("{{APP_JS}}", assets.js).replaceAll("{{APP_CSS}}", assets.css);
			}
			return res.type("html").send(html);
		} catch (error) {
			return next(error);
		}
	};
}
