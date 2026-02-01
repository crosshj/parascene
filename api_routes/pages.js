import express from "express";
import path from "path";
import { clearAuthCookie, COOKIE_NAME } from "./auth.js";
import { injectCommonHead } from "./utils/head.js";

function getPageForUser(user) {
	const roleToPage = {
		consumer: "app.html",
		creator: "app.html",
		provider: "app.html",
		admin: "app-admin.html"
	};
	return roleToPage[user.role] || "app.html";
}

export default function createPageRoutes({ queries, pagesDir }) {
	const router = express.Router();

	function normalizeReturnUrl(raw) {
		const value = typeof raw === "string" ? raw.trim() : "";
		if (!value) return "/";
		if (!value.startsWith("/")) return "/";
		if (value.startsWith("//")) return "/";
		if (value.includes("://")) return "/";
		if (value.length > 2048) return "/";
		// Never return to auth pages after login
		if (value === "/auth" || value === "/auth.html") return "/";
		return value;
	}

	function redirectToAuth(req, res) {
		const returnUrl = normalizeReturnUrl(req?.originalUrl || req?.path || "/");
		const qs = new URLSearchParams({ returnUrl });
		return res.redirect(`/auth.html?${qs.toString()}`);
	}

	async function requireLoggedInUser(req, res) {
		const userId = req.auth?.userId;
		if (!userId) {
			redirectToAuth(req, res);
			return null;
		}

		const user = await queries.selectUserById.get(userId);
		if (!user) {
			// Only clear cookie if it was actually sent
			if (req.cookies?.[COOKIE_NAME]) {
				clearAuthCookie(res, req);
			}
			redirectToAuth(req, res);
			return null;
		}

		return user;
	}

	// Welcome (server-sent, minimal chrome)
	router.get("/welcome", async (req, res) => {
		const user = await requireLoggedInUser(req, res);
		if (!user) return;
		try {
			const fs = await import("fs/promises");
			let htmlContent = await fs.readFile(path.join(pagesDir, "welcome.html"), "utf-8");
			htmlContent = injectCommonHead(htmlContent);
			res.setHeader("Content-Type", "text/html");
			return res.send(htmlContent);
		} catch (error) {
			return res.status(500).send("Internal server error");
		}
	});

	// Handle root and index.html - same logic
	router.get(["/", "/index.html"], async (req, res) => {
		const userId = req.auth?.userId;

		// NOT logged in → landing page
		if (!userId) {
			const fs = await import("fs/promises");
			let htmlContent = await fs.readFile(path.join(pagesDir, "index.html"), "utf-8");
			htmlContent = injectCommonHead(htmlContent);
			res.setHeader("Content-Type", "text/html");
			return res.send(htmlContent);
		}

		// Logged in → get role and serve role page
		const user = await queries.selectUserById.get(userId);
		if (!user) {
			// Only clear cookie if it was actually sent
			if (req.cookies?.[COOKIE_NAME]) {
				clearAuthCookie(res, req);
			}
			const fs = await import("fs/promises");
			let htmlContent = await fs.readFile(path.join(pagesDir, "index.html"), "utf-8");
			htmlContent = injectCommonHead(htmlContent);
			res.setHeader("Content-Type", "text/html");
			return res.send(htmlContent);
		}

		// Serve role-based page
		const page = getPageForUser(user);
		const fs = await import("fs/promises");
		let htmlContent = await fs.readFile(path.join(pagesDir, page), "utf-8");
		htmlContent = injectCommonHead(htmlContent);
		res.setHeader("Content-Type", "text/html");
		return res.send(htmlContent);
	});

	// User profile page - /user (me) and /user/:id (view user)
	router.get(["/user", "/user/:id"], async (req, res) => {
		const user = await requireLoggedInUser(req, res);
		if (!user) return;

		// If /user/:id, validate target exists (avoid blank profile pages)
		const rawTargetId = req.params?.id;
		if (rawTargetId) {
			const targetId = Number.parseInt(rawTargetId, 10);
			if (!Number.isFinite(targetId) || targetId <= 0) {
				return res.status(404).send("Not found");
			}
			const target = await queries.selectUserById.get(targetId);
			if (!target) {
				return res.status(404).send("User not found");
			}
		}

		try {
			const fs = await import("fs/promises");
			const rolePageName = getPageForUser(user);
			const rolePagePath = path.join(pagesDir, rolePageName);
			const htmlPath = path.join(pagesDir, "user-profile.html");
			let pageHtml = await fs.readFile(htmlPath, "utf-8");

			// Inject the correct role header by copying it from the role-based page.
			let headerHtml = "";
			let includeMobileBottomNav = false;
			try {
				const roleHtml = await fs.readFile(rolePagePath, "utf-8");
				const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
				if (headerMatch) {
					headerHtml = headerMatch[0];
				}
				includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
			} catch (error) {
				// console.warn("Failed to extract role header for profile page:", error?.message || error);
			}

			if (headerHtml) {
				pageHtml = pageHtml.replace("<!--APP_HEADER-->", headerHtml);
			}
			pageHtml = pageHtml.replace(
				"<!--APP_MOBILE_BOTTOM_NAV-->",
				includeMobileBottomNav ? "<app-navigation-mobile></app-navigation-mobile>" : ""
			);

			pageHtml = injectCommonHead(pageHtml);

			res.setHeader("Content-Type", "text/html");
			return res.send(pageHtml);
		} catch (error) {
			// console.error("Error loading user profile page:", error);
			return res.status(500).send("Internal server error");
		}
	});

	async function serveCreationMutatePage(req, res) {
		const user = await requireLoggedInUser(req, res);
		if (!user) return;

		// Verify the creation exists and is either published or belongs to the user
		const creationId = parseInt(req.params.id, 10);
		if (!creationId) {
			return serveNotFoundPage(req, res, user);
		}

		try {
			// First try to get as owner
			let image = await queries.selectCreatedImageById.get(creationId, user.id);

			// If not found as owner, check if it exists and is either published or user is admin
			if (!image) {
				const anyImage = await queries.selectCreatedImageByIdAnyUser.get(creationId);
				if (anyImage) {
					const isPublished = anyImage.published === 1 || anyImage.published === true;
					const isAdmin = user.role === 'admin';
					if (isPublished || isAdmin) {
						image = anyImage;
					} else {
						return serveNotFoundPage(req, res, user);
					}
				} else {
					return serveNotFoundPage(req, res, user);
				}
			}

			// Read the HTML file and inject the correct role-based header and mobile nav
			const fs = await import('fs/promises');
			const rolePageName = getPageForUser(user);
			const rolePagePath = path.join(pagesDir, rolePageName);
			const htmlPath = path.join(pagesDir, "creation-edit.html");
			let pageHtml = await fs.readFile(htmlPath, 'utf-8');

			let headerHtml = "";
			let includeMobileBottomNav = false;
			try {
				const roleHtml = await fs.readFile(rolePagePath, "utf-8");
				const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
				if (headerMatch) {
					headerHtml = headerMatch[0];
				}
				includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
			} catch (error) {
				// console.warn("Failed to extract role header for creation mutate page:", error?.message || error);
			}

			if (headerHtml) {
				pageHtml = pageHtml.replace("<!--APP_HEADER-->", headerHtml);
			}
			pageHtml = pageHtml.replace(
				"<!--APP_MOBILE_BOTTOM_NAV-->",
				includeMobileBottomNav ? "<app-navigation-mobile></app-navigation-mobile>" : ""
			);

			pageHtml = injectCommonHead(pageHtml);

			res.setHeader('Content-Type', 'text/html');
			return res.send(pageHtml);
		} catch (error) {
			// console.error("Error loading creation mutate:", error);
			return res.status(500).send("Internal server error");
		}
	}

	async function serveNotFoundPage(req, res, user) {
		try {
			const fs = await import("fs/promises");
			const rolePageName = getPageForUser(user);
			const rolePagePath = path.join(pagesDir, rolePageName);
			const htmlPath = path.join(pagesDir, "not-found.html");
			let pageHtml = await fs.readFile(htmlPath, "utf-8");

			let headerHtml = "";
			let includeMobileBottomNav = false;
			try {
				const roleHtml = await fs.readFile(rolePagePath, "utf-8");
				const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
				if (headerMatch) {
					headerHtml = headerMatch[0];
				}
				includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
			} catch (error) {
				// console.warn("Failed to extract role header for not found page:", error?.message || error);
			}

			if (headerHtml) {
				pageHtml = pageHtml.replace("<!--APP_HEADER-->", headerHtml);
			}
			pageHtml = pageHtml.replace(
				"<!--APP_MOBILE_BOTTOM_NAV-->",
				includeMobileBottomNav ? "<app-navigation-mobile></app-navigation-mobile>" : ""
			);

			pageHtml = injectCommonHead(pageHtml);

			res.setHeader("Content-Type", "text/html");
			return res.status(404).send(pageHtml);
		} catch (error) {
			return res.status(404).send("Not found");
		}
	}

	// Route for creation mutate page - /creations/:id/mutate
	router.get("/creations/:id/mutate", serveCreationMutatePage);

	// Back-compat: redirect /creations/:id/mutat -> /creations/:id/mutate
	router.get("/creations/:id/mutat", async (req, res) => {
		const rawId = typeof req.params?.id === 'string' ? req.params.id : '';
		return res.redirect(`/creations/${rawId}/mutate`);
	});

	// Back-compat: redirect /creations/:id/edit -> /creations/:id/mutate
	router.get("/creations/:id/edit", async (req, res) => {
		const rawId = typeof req.params?.id === 'string' ? req.params.id : '';
		return res.redirect(`/creations/${rawId}/mutate`);
	});

	// Route for creation detail page - /creations/:id
	router.get("/creations/:id", async (req, res) => {
		const user = await requireLoggedInUser(req, res);
		if (!user) return;

		// Verify the creation exists and is either published or belongs to the user
		const creationId = parseInt(req.params.id, 10);
		if (!creationId) {
			return serveNotFoundPage(req, res, user);
		}

		try {
			// First try to get as owner
			let image = await queries.selectCreatedImageById.get(creationId, user.id);

			// If not found as owner, check if it exists and is either published or user is admin
			if (!image) {
				const anyImage = await queries.selectCreatedImageByIdAnyUser.get(creationId);
				if (anyImage) {
					const isPublished = anyImage.published === 1 || anyImage.published === true;
					const isAdmin = user.role === 'admin';
					if (isPublished || isAdmin) {
						image = anyImage;
					} else {
						return serveNotFoundPage(req, res, user);
					}
				} else {
					return serveNotFoundPage(req, res, user);
				}
			}

			// Read the HTML file and inject the correct role-based header and mobile nav
			const fs = await import('fs/promises');
			const rolePageName = getPageForUser(user);
			const rolePagePath = path.join(pagesDir, rolePageName);
			const htmlPath = path.join(pagesDir, "creation-detail.html");
			let pageHtml = await fs.readFile(htmlPath, 'utf-8');

			let headerHtml = "";
			let includeMobileBottomNav = false;
			try {
				const roleHtml = await fs.readFile(rolePagePath, "utf-8");
				const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
				if (headerMatch) {
					headerHtml = headerMatch[0];
				}
				includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
			} catch (error) {
				// console.warn("Failed to extract role header for creation detail page:", error?.message || error);
			}

			if (headerHtml) {
				pageHtml = pageHtml.replace("<!--APP_HEADER-->", headerHtml);
			}
			pageHtml = pageHtml.replace(
				"<!--APP_MOBILE_BOTTOM_NAV-->",
				includeMobileBottomNav ? "<app-navigation-mobile></app-navigation-mobile>" : ""
			);

			pageHtml = injectCommonHead(pageHtml);

			res.setHeader('Content-Type', 'text/html');
			return res.send(pageHtml);
		} catch (error) {
			// console.error("Error loading creation detail:", error);
			return res.status(500).send("Internal server error");
		}
	});

	// Auth page (supports returnUrl query param).
	router.get("/auth.html", async (req, res) => {
		const fs = await import("fs/promises");
		let htmlContent = await fs.readFile(path.join(pagesDir, "auth.html"), "utf-8");
		htmlContent = injectCommonHead(htmlContent);
		res.setHeader("Content-Type", "text/html");
		return res.send(htmlContent);
	});

	// Catch-all route for sub-routes - serve the same page for all routes
	// This allows clean URLs like /feed, /explore, etc. while serving the same HTML
	router.get("/*", async (req, res, next) => {
		// Skip if it's an API route, static file, or known endpoint
		if (req.path.startsWith("/api/") ||
			req.path.startsWith("/admin/users") ||
			req.path.startsWith("/creations/") ||
			req.path === "/welcome" ||
			req.path === "/user" ||
			req.path.startsWith("/user/") ||
			req.path === "/me" ||
			req.path === "/signup" ||
			req.path === "/login" ||
			req.path === "/logout" ||
			req.path === "/index.html") {
			return next(); // Let other routes handle it or 404
		}

		const userId = req.auth?.userId;

		// If NOT logged in → require authentication
		if (!userId) {
			// If user requests /auth or /auth.html directly, serve auth page without redirect
			if (req.path === "/auth" || req.path === "/auth.html") {
				const fs = await import("fs/promises");
				let htmlContent = await fs.readFile(path.join(pagesDir, "auth.html"), "utf-8");
				htmlContent = injectCommonHead(htmlContent);
				res.setHeader("Content-Type", "text/html");
				return res.send(htmlContent);
			}
			return redirectToAuth(req, res);
		}

		// If logged in → get user and their role
		const user = await queries.selectUserById.get(userId);
		if (!user) {
			// Only clear cookie if it was actually sent
			if (req.cookies?.[COOKIE_NAME]) {
				clearAuthCookie(res, req);
			}
			return redirectToAuth(req, res);
		}

		// User is logged in and has a role → serve their role-based page
		// Client-side routing handles the rest (feed, explore, etc.)
		const page = getPageForUser(user);
		const fs = await import("fs/promises");
		let htmlContent = await fs.readFile(path.join(pagesDir, page), "utf-8");
		htmlContent = injectCommonHead(htmlContent);
		res.setHeader("Content-Type", "text/html");
		return res.send(htmlContent);
	});

	return router;
}
