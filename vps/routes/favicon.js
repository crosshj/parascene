import express from "express";
import path from "node:path";

/** The VPS serves beta; local development uses a green tile instead of blue. */
export function createFaviconRoutes({ publicDir }) {
	const router = express.Router();
	router.get('/favicon.svg', (req, res) => {
		const hostname = String(req.hostname || '').toLowerCase();
		const local = process.env.NODE_ENV !== 'production' ||
			hostname === 'localhost' || hostname.endsWith('.localhost') ||
			hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
		res.set('Cache-Control', 'no-store');
		res.sendFile(path.join(publicDir, `favicon-${local ? 'local' : 'beta'}.svg`));
	});
	return router;
}
