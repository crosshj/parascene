import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { createSpaFallback } from "./middleware/spa.js";
import { getAppAssetNames } from "./utils/appAssets.js";
import { filesOriginForRequest } from "./utils/origins.js";

const PAGE_ROUTES = {
	"/": "index/index.html",
	"/index.html": "index/index.html",
	"/auth": "auth/auth.html",
	"/auth.html": "auth/auth.html"
};

const DEFAULT_CANONICAL_ORIGIN = "https://www.parascene.com";

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function canonicalUrlForRequest(req) {
	const pathOnly = (req.originalUrl || req.path || "/").split("?")[0] || "/";
	const origin = (process.env.APP_ORIGIN || DEFAULT_CANONICAL_ORIGIN).replace(/\/$/, "");
	return `${origin}${pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`}`;
}

function serializeBootstrap(value) {
	return JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll(">", "\\u003e")
		.replaceAll("&", "\\u0026")
		.replaceAll("/", "\\u002f");
}

async function sendPage(req, res, next, filePath, users, buildDir) {
	try {
		let html = await fs.readFile(filePath, "utf8");
		html = html.replace("{{CANONICAL_LINK}}", `<link rel="canonical" href="${escapeHtml(canonicalUrlForRequest(req))}" />`);
		if (html.includes("{{APP_BOOTSTRAP}}")) {
			const user = req.auth?.userId ? await users?.byId(req.auth.userId) : null;
			const profile = req.auth?.userId ? await users?.profileByUserId(req.auth.userId) : null;
			const bootstrap = {
				user: user ? { ...user, profile: profile || null } : null,
				clientRoute: req.originalUrl || req.path || "/",
				filesOrigin: filesOriginForRequest(req)
			};
			html = html.replace("{{APP_BOOTSTRAP}}", `<script>window.__PARASCENE_BOOTSTRAP__=${serializeBootstrap(bootstrap)};</script>`);
		}
		if (html.includes("{{APP_JS}}") || html.includes("{{APP_CSS}}")) {
			const assets = await getAppAssetNames(buildDir);
			html = html.replaceAll("{{APP_JS}}", assets.js).replaceAll("{{APP_CSS}}", assets.css);
		}
		res.type("html").send(html);
	} catch (error) {
		next(error);
	}
}

/** Serve page modules and their CSS/JS/assets from pages/<page>/. */
export default function createPageRoutes({ pagesDir, users }) {
	const router = express.Router();
	const buildDir = path.join(pagesDir, "..", "build");

	for (const [route, relativePath] of Object.entries(PAGE_ROUTES)) {
		router.get(route, (req, res, next) => {
			const pagePath = (route === "/" || route === "/index.html") && req.auth?.userId
				? path.join(pagesDir, "app/app.html")
				: path.join(pagesDir, relativePath);
			sendPage(req, res, next, pagePath, users, buildDir);
		});
	}

	// Keep the on-disk page-module layout private; expose assets at page-relative URLs.
	router.use(express.static(pagesDir, { index: false }));
	router.use("/build", express.static(path.join(pagesDir, "..", "build"), {
		index: false,
		maxAge: "1y",
		immutable: true
	}));
	router.use(createSpaFallback({ appPagePath: path.join(pagesDir, "app/app.html"), users, buildDir }));

	return router;
}

export { PAGE_ROUTES };
