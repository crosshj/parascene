import express from "express";
import path from "node:path";

const PAGE_ROUTES = {
	"/": "index/index.html",
	"/index.html": "index/index.html",
	"/auth": "auth/auth.html",
	"/auth.html": "auth/auth.html"
};

/** Serve page modules and their CSS/JS/assets from pages/<page>/. */
export default function createPageRoutes({ pagesDir }) {
	const router = express.Router();

	for (const [route, relativePath] of Object.entries(PAGE_ROUTES)) {
		router.get(route, (req, res, next) => {
			res.sendFile(path.join(pagesDir, relativePath), (error) => {
				if (error) next(error);
			});
		});
	}

	// Keep the on-disk page-module layout private; expose assets at page-relative URLs.
	router.use(express.static(pagesDir, { index: false }));

	return router;
}

export { PAGE_ROUTES };
