import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import { openDb } from "../db/index.js";
import createAdminRoutes from "./admin.js";
import createExploreRoutes from "./explore.js";
import createFeedRoutes from "./feed.js";
import createCreateRoutes from "./create.js";
import createCreationsRoutes from "./creations.js";
import createPageRoutes from "./pages.js";
import createProviderRoutes from "./provider.js";
import createServersRoutes from "./servers.js";
import createTemplatesRoutes from "./templates.js";
import createUserRoutes from "./user.js";
import { authMiddleware, clearAuthCookie } from "./auth.js";

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pagesDir = path.join(__dirname, "..", "pages");
const staticDir = path.join(__dirname, "..", "static");

// Initialize database asynchronously using top-level await
const { queries } = await openDb();

app.use(express.static(staticDir));
// Serve CSS/JS from pagesDir, but NEVER serve HTML files - they go through routes
app.use('/index.css', express.static(path.join(pagesDir, 'index.css')));
app.use('/index.js', express.static(path.join(pagesDir, 'index.js')));
app.use('/auth.css', express.static(path.join(pagesDir, 'auth.css')));
app.use('/auth.js', express.static(path.join(pagesDir, 'auth.js')));
app.use('/consumer.css', express.static(path.join(pagesDir, 'consumer.css')));
app.use('/consumer.js', express.static(path.join(pagesDir, 'consumer.js')));
app.use('/creator.css', express.static(path.join(pagesDir, 'creator.css')));
app.use('/creator.js', express.static(path.join(pagesDir, 'creator.js')));
app.use('/provider.css', express.static(path.join(pagesDir, 'provider.css')));
app.use('/provider.js', express.static(path.join(pagesDir, 'provider.js')));
app.use('/admin.css', express.static(path.join(pagesDir, 'admin.css')));
app.use('/admin.js', express.static(path.join(pagesDir, 'admin.js')));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(authMiddleware());
app.use(createUserRoutes({ queries }));

app.use(createAdminRoutes({ queries }));
app.use(createFeedRoutes({ queries }));
app.use(createExploreRoutes({ queries }));
app.use(createCreateRoutes({ queries }));
app.use(createCreationsRoutes({ queries }));
app.use(createProviderRoutes({ queries }));
app.use(createServersRoutes({ queries }));
app.use(createTemplatesRoutes({ queries }));
app.use(createPageRoutes({ queries, pagesDir }));

app.use((err, req, res, next) => {
  if (err?.name !== "UnauthorizedError") {
    return next(err);
  }

  clearAuthCookie(res);

  if (req.path.startsWith("/api/") || req.path === "/me") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.sendFile(path.join(pagesDir, "auth.html"));
});

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Parascene dev server running on http://localhost:${port}`);
  });
}

export default app;
