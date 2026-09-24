import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthRoutes } from "./routes/auth.js";
import { createCdnRoutes } from "./routes/cdn.js";
import { createAuthMiddleware } from "./routes/middleware/auth.js";
import { createCdnHostBoundary } from "./routes/middleware/cdnHost.js";
import createPageRoutes from "./routes/pages.js";
import { createDb } from "./db/index.js";

const port = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.join(__dirname, "pages");
const app = express();
const db = createDb();

app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(createAuthMiddleware(db.sessions));
app.use(createCdnHostBoundary(createCdnRoutes(db.profileFiles)));
app.use(createAuthRoutes({ users: db.users, sessions: db.sessions }));
app.use(createPageRoutes({ pagesDir, users: db.users }));
app.use(express.static(path.join(__dirname, "public")));
app.use((error, req, res, next) => {
	console.error("[beta] request failed", error);
	if (res.headersSent) return next(error);
	res.status(500).json({ error: "Internal server error" });
});

app.listen(port, "0.0.0.0", () => console.log(`Parascene beta listening on port ${port}`));
