import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import { openDb } from "./db/index.js";
import createAdminRoutes from "./api/admin.js";
import createExploreRoutes from "./api/explore.js";
import createFeedRoutes from "./api/feed.js";
import createPostsRoutes from "./api/posts.js";
import createPageRoutes from "./api/pages.js";
import createProviderRoutes from "./api/provider.js";
import createServersRoutes from "./api/servers.js";
import createTemplatesRoutes from "./api/templates.js";
import createUserRoutes from "./api/user.js";

const app = express();
const port = process.env.PORT;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pagesDir = path.join(__dirname, "pages");
const staticDir = path.join(__dirname, "static");
const { queries } = openDb();

app.use(express.static(staticDir));
app.use(express.static(pagesDir));
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true }
  })
);
app.use(createUserRoutes({ queries }));

app.use(createAdminRoutes({ queries }));
app.use(createFeedRoutes({ queries }));
app.use(createExploreRoutes({ queries }));
app.use(createPostsRoutes({ queries }));
app.use(createProviderRoutes({ queries }));
app.use(createServersRoutes({ queries }));
app.use(createTemplatesRoutes({ queries }));
app.use(createPageRoutes({ queries, pagesDir }));

app.listen(port, () => {
  console.log(`Parascene dev server running on http://localhost:${port}`);
});
