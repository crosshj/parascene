import express from "express";
import path from "node:path";

function isLocalHost(req) {
	const hostname = String(req.hostname || '').toLowerCase();
	return process.env.NODE_ENV !== 'production' ||
		hostname === 'localhost' || hostname.endsWith('.localhost') ||
		hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

/** Local development is green, beta is blue, and the production site is purple. */
export function createFaviconRoutes({ publicDir }) {
	const router = express.Router();
	function send(req, res, name) {
		res.set('Cache-Control', 'no-store');
		res.sendFile(path.join(publicDir, name));
	}
	function faviconBase(req) {
		if (isLocalHost(req)) return 'favicon-local';
		return String(req.hostname || '').toLowerCase() === 'beta.parascene.com'
			? 'favicon-app'
			: 'favicon';
	}
	router.get('/favicon.svg', (req, res) => send(req, res, `${faviconBase(req)}.svg`));
	router.get('/favicon-unread.svg', (req, res) => send(req, res, `${faviconBase(req)}-unread.svg`));
	return router;
}
