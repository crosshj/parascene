import express from "express";
import path from "path";
import { clearAuthCookie, COOKIE_NAME } from "./auth.js";
const html = String.raw;

function getPageForUser(user) {
  const roleToPage = {
    consumer: "consumer.html",
    creator: "creator.html",
    provider: "provider.html",
    admin: "admin.html"
  };
  return roleToPage[user.role] || "consumer.html";
}

export default function createPageRoutes({ queries, pagesDir }) {
  const router = express.Router();

  // Handle root and index.html - same logic
  router.get(["/", "/index.html"], async (req, res) => {
    const userId = req.auth?.userId;
    
    // NOT logged in → landing page
    if (!userId) {
      return res.sendFile(path.join(pagesDir, "index.html"));
    }

    // Logged in → get role and serve role page
    const user = await queries.selectUserById.get(userId);
    if (!user) {
      // Only clear cookie if it was actually sent
      if (req.cookies?.[COOKIE_NAME]) {
        clearAuthCookie(res, req);
      }
      return res.sendFile(path.join(pagesDir, "index.html"));
    }

    // Serve role-based page
    const page = getPageForUser(user);
    return res.sendFile(path.join(pagesDir, page));
  });

  // Route for creation detail page - /creations/:id
  router.get("/creations/:id", async (req, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.sendFile(path.join(pagesDir, "auth.html"));
    }

    const user = await queries.selectUserById.get(userId);
    if (!user) {
      // Only clear cookie if it was actually sent
      if (req.cookies?.[COOKIE_NAME]) {
        clearAuthCookie(res, req);
      }
      return res.sendFile(path.join(pagesDir, "auth.html"));
    }

    // Verify the creation exists and is either published or belongs to the user
    const creationId = parseInt(req.params.id, 10);
    if (!creationId) {
      return res.status(404).send("Not found");
    }

    try {
      // First try to get as owner
      let image = await queries.selectCreatedImageById.get(creationId, userId);
      
      // If not found as owner, check if it exists and is published
      if (!image) {
        const anyImage = await queries.selectCreatedImageByIdAnyUser.get(creationId);
        if (anyImage && (anyImage.published === 1 || anyImage.published === true)) {
          image = anyImage;
        } else {
          return res.status(404).send("Creation not found");
        }
      }

      // Read the HTML file and inject user role
      const fs = await import('fs/promises');
      const htmlPath = path.join(pagesDir, "creation-detail.html");
      let pageHtml = await fs.readFile(htmlPath, 'utf-8');
      
      // Inject user role as a script variable before the closing head tag
      const roleScript = html`<script>window.__USER_ROLE__ = ${JSON.stringify(user.role)};</script>`;
      pageHtml = pageHtml.replace('</head>', `${roleScript}</head>`);
      
      res.setHeader('Content-Type', 'text/html');
      return res.send(pageHtml);
    } catch (error) {
      console.error("Error loading creation detail:", error);
      return res.status(500).send("Internal server error");
    }
  });

  // Catch-all route for sub-routes - serve the same page for all routes
  // This allows clean URLs like /feed, /explore, etc. while serving the same HTML
  router.get("/*", async (req, res, next) => {
    // Skip if it's an API route, static file, or known endpoint
    if (req.path.startsWith("/api/") ||
        req.path.startsWith("/admin/users") ||
        req.path.startsWith("/creations/") ||
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
      return res.sendFile(path.join(pagesDir, "auth.html"));
    }

    // If logged in → get user and their role
    const user = await queries.selectUserById.get(userId);
    if (!user) {
      // Only clear cookie if it was actually sent
      if (req.cookies?.[COOKIE_NAME]) {
        clearAuthCookie(res, req);
      }
      return res.sendFile(path.join(pagesDir, "auth.html"));
    }

    // User is logged in and has a role → serve their role-based page
    // Client-side routing handles the rest (feed, explore, etc.)
    const page = getPageForUser(user);
    return res.sendFile(path.join(pagesDir, page));
  });

  return router;
}
