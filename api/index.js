import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import { openDb } from "../db/index.js";
import createAdminRoutes from "../api_routes/admin.js";
import createExploreRoutes from "../api_routes/explore.js";
import createFeedRoutes from "../api_routes/feed.js";
import createCreateRoutes from "../api_routes/create.js";
import createCreationsRoutes from "../api_routes/creations.js";
import createImagesRoutes from "../api_routes/images.js";
import createPageRoutes from "../api_routes/pages.js";
import createProviderRoutes from "../api_routes/provider.js";
import createServersRoutes from "../api_routes/servers.js";
import createTemplatesRoutes from "../api_routes/templates.js";
import createLikesRoutes from "../api_routes/likes.js";
import createCommentsRoutes from "../api_routes/comments.js";
import createUserRoutes from "../api_routes/user.js";
import createTodoRoutes from "../api_routes/todo.js";
import {
	authMiddleware,
	clearAuthCookie,
	COOKIE_NAME,
	probabilisticSessionCleanup,
	sessionMiddleware
} from "../api_routes/auth.js";

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
	console.error("Unhandled Promise Rejection:", reason);
	if (reason instanceof Error) {
		console.error("Error stack:", reason.stack);
	}
	// Don't exit in production, but log the error
	if (process.env.NODE_ENV === "production") {
		console.error("Continuing in production mode...");
	} else {
		console.error("Exiting due to unhandled rejection in development");
		process.exit(1);
	}
});

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pagesDir = path.join(__dirname, "..", "pages");
const staticDir = path.join(__dirname, "..", "static");

// Initialize database asynchronously using top-level await
let queries, storage;
try {
	console.log("[Startup] Initializing database...");
	console.log("[Startup] Environment:", {
		VERCEL: !!process.env.VERCEL,
		NODE_ENV: process.env.NODE_ENV,
		DB_ADAPTER: process.env.DB_ADAPTER || "sqlite (default)"
	});
	const dbResult = await openDb();
	queries = dbResult.queries;
	storage = dbResult.storage;
	console.log("[Startup] Database initialized successfully");
} catch (error) {
	console.error("[Startup] Failed to initialize database:", error);
	console.error("[Startup] Error details:", error.message);
	if (error.message?.includes("Missing required env var")) {
		console.error("\n[Startup] Please ensure all required environment variables are set.");
		console.error("[Startup] For Supabase: SUPABASE_URL and SUPABASE_ANON_KEY are required.");
	}
	process.exit(1);
}

app.use(express.static(staticDir));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Make storage accessible to routes that need it.
app.locals.storage = storage;

// Add request logging middleware for debugging
app.use((req, res, next) => {
	console.log(`[Request] ${req.method} ${req.path}`, {
		hasCookie: !!req.cookies?.[COOKIE_NAME],
		cookieValue: req.cookies?.[COOKIE_NAME] ? `${req.cookies[COOKIE_NAME].substring(0, 20)}...` : "none",
		userAgent: req.get("user-agent")?.substring(0, 50),
		referer: req.get("referer")
	});
	next();
});

app.use(authMiddleware());
app.use(sessionMiddleware(queries));
app.use(probabilisticSessionCleanup(queries));
app.use(createUserRoutes({ queries }));

app.use(createAdminRoutes({ queries }));
app.use(createFeedRoutes({ queries }));
app.use(createExploreRoutes({ queries }));
app.use(createCreateRoutes({ queries, storage }));
app.use(createImagesRoutes({ storage }));
app.use(createCreationsRoutes({ queries }));
app.use(createLikesRoutes({ queries }));
app.use(createCommentsRoutes({ queries }));
app.use(createProviderRoutes({ queries }));
app.use(createServersRoutes({ queries }));
app.use(createTemplatesRoutes({ queries }));
app.use(createPageRoutes({ queries, pagesDir }));
app.use(createTodoRoutes());

app.use((err, req, res, next) => {
	if (err?.name !== "UnauthorizedError") {
		return next(err);
	}

	console.log(
		`[ErrorHandler] UnauthorizedError for path: ${req.path}, ` +
		`cookie present: ${!!req.cookies?.[COOKIE_NAME]}, ` +
		`error: ${err.message || "Unknown"}`
	);

	// Only clear cookie if one was actually sent in the request
	// This prevents clearing cookies that weren't sent (e.g., due to SameSite issues)
	if (req.cookies?.[COOKIE_NAME]) {
		console.log(`[ErrorHandler] Clearing cookie due to UnauthorizedError`);
		clearAuthCookie(res, req);
	} else {
		console.log(`[ErrorHandler] No cookie present, skipping clear`);
	}

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

// Log startup completion
console.log("[Startup] Express app configured and ready");
console.log("[Startup] Routes registered:", {
	userRoutes: "✓",
	adminRoutes: "✓",
	feedRoutes: "✓",
	exploreRoutes: "✓",
	createRoutes: "✓",
	creationsRoutes: "✓",
	providerRoutes: "✓",
	serversRoutes: "✓",
	templatesRoutes: "✓",
	pageRoutes: "✓"
});

export default app;
