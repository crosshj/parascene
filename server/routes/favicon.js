import express from "express";
import path from "node:path";

function isLocalHost(req) {
	const hostname = String(req.hostname || '').toLowerCase();
	return process.env.NODE_ENV !== 'production' ||
		hostname === 'localhost' || hostname.endsWith('.localhost') ||
		hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

/** The VPS serves beta; local development uses a green tile instead of blue. */
export function createFaviconRoutes({ publicDir }) {
	const router = express.Router();
	function send(req, res, name) {
		res.set('Cache-Control', 'no-store');
		res.sendFile(path.join(publicDir, name));
	}
	router.get('/favicon.svg', (req, res) => send(req, res, `favicon-${isLocalHost(req) ? 'local' : 'beta'}.svg`));
	router.get('/favicon-unread.svg', (req, res) => send(req, res, `favicon-${isLocalHost(req) ? 'local' : 'beta'}-unread.svg`));
	return router;
}
