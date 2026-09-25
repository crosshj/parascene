import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { createAuthRoutes } from "./routes/auth.js";
import { createCdnRoutes } from "./routes/cdn.js";
import { createAuthMiddleware } from "./routes/middleware/auth.js";
import { createCdnHostBoundary } from "./routes/middleware/cdnHost.js";
import createPageRoutes from "./routes/pages.js";
import { createDb } from "./db/index.js";

// Supabase Realtime needs a WebSocket implementation on Node 20.
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

const port = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bindHost = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
const pagesDir = path.join(__dirname, "pages");
const app = express();
const db = createDb();

app.set("trust proxy", true);
app.use("/api/auth", express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(createAuthMiddleware(db.sessions));
app.use(createCdnHostBoundary(createCdnRoutes({ profileFiles: db.profileFiles, genericFiles: db.genericFiles, users: db.users })));
app.use(createAuthRoutes({ users: db.users, sessions: db.sessions }));
app.use(createPageRoutes({ pagesDir, users: db.users }));
app.use(express.static(path.join(__dirname, "public")));
app.use((error, req, res, next) => {
	console.error("[beta] request failed", error);
	if (res.headersSent) return next(error);
	res.status(500).json({ error: "Internal server error" });
});

app.listen(port, bindHost, () => {
	console.log(`Parascene beta dev server: http://localhost:${port}/`);
	console.log(`[beta] bound to ${bindHost}:${port}`);
});
