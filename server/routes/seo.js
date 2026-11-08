import express from "express";

const PUBLIC_ORIGIN = "https://www.parascene.com";
const SITEMAP_LASTMOD = "2026-11-08";

const SITEMAP_URLS = [
	["/", "weekly", "1.0"],
	["/pricing", "monthly", "0.8"],
	["/help", "monthly", "0.8"],
	["/help/privacy", "monthly", "0.6"],
	["/help/terms-of-service", "monthly", "0.6"],
	["/help/about/site-and-mission", "monthly", "0.6"],
	["/help/about/ai-and-creation", "monthly", "0.6"],
	["/help/create/basic", "monthly", "0.6"],
	["/help/create/advanced", "monthly", "0.6"],
	["/help/create/creations-list", "monthly", "0.5"],
	["/help/create/ideas-and-examples", "monthly", "0.6"],
	["/help/connect/share-your-creations", "monthly", "0.5"],
	["/help/connect/follow-creators", "monthly", "0.5"],
	["/help/connect/join-a-server", "monthly", "0.5"],
	["/help/connect/request-a-feature", "monthly", "0.4"],
	["/help/discover/feed-list", "monthly", "0.4"],
	["/help/discover/explore-list", "monthly", "0.4"],
	["/help/discover/recent-comments", "monthly", "0.4"],
	["/help/credits/daily-credits", "monthly", "0.5"],
	["/help/credits/tipping", "monthly", "0.5"],
	["/help/credits/upgrade-plan", "monthly", "0.5"],
	["/help/credits/run-a-server", "monthly", "0.5"],
	["/help/content-safety", "monthly", "0.5"]
];

function buildSitemap() {
	const urls = SITEMAP_URLS.map(([path, changefreq, priority]) => `	<url>\n		<loc>${PUBLIC_ORIGIN}${path}</loc>\n		<lastmod>${SITEMAP_LASTMOD}</lastmod>\n		<changefreq>${changefreq}</changefreq>\n		<priority>${priority}</priority>\n	</url>`).join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export default function createSeoRoutes() {
	const router = express.Router();
	router.get("/robots.txt", (_req, res) => {
		res.type("text/plain").send(`User-agent: *\nAllow: /\n\nSitemap: ${PUBLIC_ORIGIN}/sitemap.xml\n`);
	});
	router.get("/sitemap.xml", (_req, res) => {
		res.type("application/xml").send(buildSitemap());
	});
	return router;
}
