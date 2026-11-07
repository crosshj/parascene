import express from "express";
import { readFileSync } from "node:fs";
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
	const manifest = JSON.parse(readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8'));
	const environments = {
		local: { favicon: 'favicon-local', iconPrefix: 'icon-local-', color: '#002412' },
		beta: { favicon: 'favicon-app', iconPrefix: 'icon-', color: '#001326' },
		prod: { favicon: 'favicon', iconPrefix: 'icon-prod-', color: '#1a1628' },
	};
	function send(req, res, name) {
		res.set('Cache-Control', 'no-store');
		res.sendFile(path.join(publicDir, name));
	}
	function environment(req) {
		if (isLocalHost(req)) return environments.local;
		return String(req.hostname || '').toLowerCase() === 'beta.parascene.com'
			? environments.beta
			: environments.prod;
	}
	router.get('/favicon.svg', (req, res) => send(req, res, `${environment(req).favicon}.svg`));
	router.get('/favicon-unread.svg', (req, res) => send(req, res, `${environment(req).favicon}-unread.svg`));
	router.get('/manifest.webmanifest', (req, res) => {
		const { color } = environment(req);
		res.set('Cache-Control', 'no-store');
		res.type('application/manifest+json').send(JSON.stringify({
			...manifest,
			background_color: color,
			theme_color: color,
		}));
	});
	for (const name of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png']) {
		router.get(`/icons/${name}`, (req, res) => {
			const asset = name.replace('icon-', environment(req).iconPrefix);
			send(req, res, path.join('icons', asset));
		});
	}
	return router;
}
