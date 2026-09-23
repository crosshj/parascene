import express from "express";
import fs from "node:fs/promises";
import path from "node:path";

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

async function sendPage(req, res, next, filePath) {
	try {
		let html = await fs.readFile(filePath, "utf8");
		html = html.replace("{{CANONICAL_LINK}}", `<link rel="canonical" href="${escapeHtml(canonicalUrlForRequest(req))}" />`);
		res.type("html").send(html);
	} catch (error) {
		next(error);
	}
}

/** Serve page modules and their CSS/JS/assets from pages/<page>/. */
export default function createPageRoutes({ pagesDir }) {
	const router = express.Router();

	for (const [route, relativePath] of Object.entries(PAGE_ROUTES)) {
		router.get(route, (req, res, next) => {
			sendPage(req, res, next, path.join(pagesDir, relativePath));
		});
	}

	// Keep the on-disk page-module layout private; expose assets at page-relative URLs.
	router.use(express.static(pagesDir, { index: false }));

	return router;
}

export { PAGE_ROUTES };
