import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { clearSessionCookie, hashToken } from "./utils/session.js";

const ADMIN_PAGES = {
	"/": { file: "index.html", label: "Overview" },
	"/todo": { file: "todo/index.html", label: "Todo" },
	"/users": { file: "users/index.html", label: "Users" },
	"/analytics": { file: "analytics/index.html", label: "Analytics" },
	"/jobs": { file: "jobs/index.html", label: "Jobs" },
	"/emails": { file: "emails/index.html", label: "Emails" },
	"/algo": { file: "algo/index.html", label: "Algo" },
	"/connect": { file: "connect/index.html", label: "Connect" }
};

function adminHeader(currentRoute) {
	const links = Object.entries(ADMIN_PAGES).map(([route, page]) =>
		`<a href="${route}"${route === currentRoute ? ' aria-current="page"' : ""}>${page.label}</a>`
	).join("");
	return `<header class="admin-header"><details class="admin-menu"><summary>${ADMIN_PAGES[currentRoute].label}<svg class="admin-menu-caret" viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5" /></svg></summary><nav class="admin-menu-panel" aria-label="Admin pages">${links}<form method="post" action="/admin/logout"><button type="submit">Log out</button></form></nav></details></header><script src="/admin/shared/admin.js" defer></script>`;
}

async function isAdmin(req, users) {
	if (!req.auth?.userId) return false;
	const user = await users?.byId?.(req.auth.userId);
	return user?.role === "admin";
}

async function sendAdminPage(req, res, next, pagesDir, relativePath, route) {
	try {
		let html = await fs.readFile(path.join(pagesDir, "admin", relativePath), "utf8");
		html = html.replace("</head>", '\t<meta name="color-scheme" content="light dark">\n\t<style>admin-tabs:not(:defined){visibility:hidden}</style>\n</head>');
		html = html.replace("{{ADMIN_HEADER}}", adminHeader(route));
		res.set("Cache-Control", "private, no-store").type("html").send(html);
	} catch (error) {
		next(error);
	}
}

export default function createAdminPageRoutes({ pagesDir, users, sessions }) {
	const router = express.Router();
	const adminDir = path.join(pagesDir, "admin");

	// Admin entry and page URLs deliberately share the site's short paths.
	for (const [route, page] of Object.entries(ADMIN_PAGES)) {
		router.get(route, async (req, res, next) => {
			try {
				if (!(await isAdmin(req, users))) return next();
				return sendAdminPage(req, res, next, pagesDir, page.file, route);
			} catch (error) {
				return next(error);
			}
		});
	}

	router.post("/admin/logout", async (req, res, next) => {
		try {
			if (req.auth?.token) await sessions?.delete?.(hashToken(req.auth.token), req.auth.userId);
			if (req.auth?.userId) users?.invalidateCache?.(req.auth.userId);
			clearSessionCookie(res, req);
			return res.redirect(303, "/auth#login");
		} catch (error) {
			return next(error);
		}
	});

	// Keep admin HTML and its colocated assets private. The HTML documents are
	// served through short, role-aware routes above; this mount serves assets.
	router.use("/admin", async (req, res, next) => {
		try {
			if (!(await isAdmin(req, users))) return res.sendStatus(req.auth?.userId ? 403 : 401);
			if (!path.extname(req.path) || /\.html$/i.test(req.path)) return res.sendStatus(404);
			return next();
		} catch (error) {
			return next(error);
		}
	}, express.static(adminDir, { index: false }));

	return router;
}
