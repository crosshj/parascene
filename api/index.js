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
import createHelpRoutes from "../api_routes/help.js";
import createBlogRoutes from "../api_routes/blog.js";
import createBlogAdminRoutes from "../api_routes/blog_admin.js";
import createProviderRoutes from "../api_routes/provider.js";
import createServersRoutes from "../api_routes/servers.js";
import createTemplatesRoutes from "../api_routes/templates.js";
import createLikesRoutes from "../api_routes/likes.js";
import createCommentsRoutes from "../api_routes/comments.js";
import createUserRoutes from "../api_routes/user.js";
import createPresenceRoutes from "../api_routes/presence.js";
import createFollowsRoutes from "../api_routes/follows.js";
import createTodoRoutes from "../api_routes/todo.js";
import createYoutubeRoutes from "../api_routes/youtube.js";
import createVynlyRoutes from "../api_routes/vynly.js";
import createXRoutes from "../api_routes/x.js";
import createFeatureRequestRoutes from "../api_routes/feature_requests.js";
import createChatRoutes from "../api_routes/chat.js";
import createSupabaseSessionRoutes from "../api_routes/supabaseSession.js";
import createShareRoutes from "../api_routes/share.js";
import createSuggestRoutes from "../api_routes/suggest.js";
import createPromptInjectionsRoutes from "../api_routes/prompt_injections.js";
import createQRRoutes from "../api_routes/qr.js";
import createPolicyRoutes from "../api_routes/policy.js";
import createTryRoutes from "../api_routes/try.js";
import {
	authMiddleware,
	apiKeyBearerMiddleware,
	integrationBearerMiddleware,
	probabilisticSessionCleanup,
	sessionMiddleware,
	shouldLogSession
} from "../api_routes/auth.js";
import createOAuthIntegrationRoutes from "../api_routes/oauthIntegration.js";
import { canonicalHostRedirect } from "../api_routes/middleware/canonicalHost.js";
import { apiSubdomainRedirect } from "../api_routes/middleware/apiSubdomainRedirect.js";
import { shareSubdomainRedirect } from "../api_routes/middleware/shareSubdomainRedirect.js";
import { clientIdMiddleware } from "../api_routes/middleware/clientId.js";
import { createWelcomeGate } from "../api_routes/middleware/welcomeGate.js";
import { createUnauthorizedHandler } from "../api_routes/middleware/unauthorizedHandler.js";
import { createPrsnCidPersistMiddleware } from "../api_routes/middleware/prsnCidPersist.js";
import { createRateLimitMiddleware } from "../api_routes/middleware/rateLimit.js";
import { createVisitPulseMiddleware } from "../api_routes/middleware/visitPulse.js";

function shouldLogStartup() {
	return process.env.ENABLE_STARTUP_LOGS === "true";
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
	console.error("[Startup] Unhandled Promise Rejection:", reason);
	if (reason instanceof Error) {
		console.error("Error stack:", reason.stack);
	}
	// Don't exit in production, but log the error
	if (process.env.NODE_ENV === "production") {
		// console.error("Continuing in production mode...");
	} else {
		// console.error("Exiting due to unhandled rejection in development");
		process.exit(1);
	}
});

process.on("uncaughtException", (error) => {
	console.error("[Startup] Uncaught Exception:", error);
	if (error instanceof Error) {
		console.error("Error stack:", error.stack);
	}
	process.exit(1);
});

const app = express();
// Trust proxy so req.ip reflects the client when behind nginx/Vercel/etc. (X-Forwarded-For).
app.set("trust proxy", true);
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pagesDir = path.join(__dirname, "..", "pages");
const staticDir = path.join(__dirname, "..", "public");

// Initialize database asynchronously using top-level await
let queries, storage;
try {
	if (shouldLogStartup()) {
		// console.log("[Startup] Initializing database...");
		// console.log("[Startup] Environment:", {
		// 	VERCEL: !!process.env.VERCEL,
		// 	NODE_ENV: process.env.NODE_ENV,
		// 	DB_ADAPTER: process.env.DB_ADAPTER || "sqlite (default)"
		// });
	}
	const dbResult = await openDb();
	queries = dbResult.queries;
	storage = dbResult.storage;
	if (shouldLogStartup()) {
		// console.log("[Startup] Database initialized successfully");
	}
} catch (error) {
	console.error("[Startup] Failed to initialize database:", error);
	console.error("[Startup] Error details:", error?.message || String(error));
	if (error.message?.includes("Missing required env var")) {
		console.error("\n[Startup] Please ensure all required environment variables are set.");
		console.error("[Startup] For Supabase: SUPABASE_URL and SUPABASE_ANON_KEY are required.");
	}

	process.exit(1);
}

// CRITICAL: Log EVERY request at the absolute top to see if Vercel is invoking the function
// app.use((req, res, next) => {
// 	console.log("[Vercel] Function invoked", {
// 		method: req.method,
// 		path: req.path,
// 		originalUrl: req.originalUrl,
// 		url: req.url,
// 		timestamp: new Date().toISOString(),
// 		userAgent: req.get("user-agent"),
// 	});
// 	next();
// });

// On Vercel, static files are served from public/ automatically, so skip express.static
// Locally, Express serves static files from public/
if (!process.env.VERCEL) {
	app.use(express.static(staticDir));
}
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Server sidebar icons live under public/images. On Vercel the rewrite sends many URLs to this handler;
// without this, /images/* falls through to the HTML catch-all and <img> gets HTML (broken icons).
app.use(
	"/images",
	express.static(path.join(staticDir, "images"), {
		index: false,
		fallthrough: false
	})
);

// Rollup chat bundle lives under public/build/ (gitignored). Without this, a missing file falls through
// to the HTML catch-all and the browser reports a MIME error on the script tag.
app.use(
	"/build",
	express.static(path.join(staticDir, "build"), {
		index: false,
		fallthrough: false
	})
);

// Ensure every browser/client gets a stable first-party ID for analytics linkage.
app.use(clientIdMiddleware);

// CORS: allow credentials so cookies are sent when frontend is on a different origin (e.g. dev port).
app.use((req, res, next) => {
	const origin = req.get("origin");
	if (origin) {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Access-Control-Allow-Credentials", "true");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-upload-kind, X-upload-name");
	}
	if (req.method === "OPTIONS") {
		return res.sendStatus(204);
	}
	next();
});

app.use(canonicalHostRedirect);
app.use(apiSubdomainRedirect);
app.use(shareSubdomainRedirect);

// Make storage accessible to routes that need it.
app.locals.storage = storage;

// Add request logging middleware for debugging
app.use((req, res, next) => {
	if (shouldLogSession()) {
		// console.log(`[Request] ${req.method} ${req.path}`, {
		// 	hasCookie: !!req.cookies?.[COOKIE_NAME],
		// 	cookieValue: req.cookies?.[COOKIE_NAME] ? `${req.cookies[COOKIE_NAME].substring(0, 20)}...` : "none",
		// 	userAgent: req.get("user-agent")?.substring(0, 50),
		// 	referer: req.get("referer")
		// });
	}
	next();
});

app.use(authMiddleware());
app.use(apiKeyBearerMiddleware(queries));
app.use(integrationBearerMiddleware());
app.use(sessionMiddleware(queries));
app.use(createVisitPulseMiddleware({ failOpen: true }));

function isPollingHeavyPath(pathname) {
	const p = String(pathname || "");
	return (
		p === "/api/chat/unread-summary" ||
		p === "/api/presence/online" ||
		p === "/api/presence/last-active" ||
		p === "/api/notifications/unread-count" ||
		p === "/api/profile"
	);
}

function isApiKeyRequest(req) {
	return req?.auth?.apiKeyAuth === true || req?.auth?.integrationAccess === true;
}
app.use(
	createRateLimitMiddleware({
		bucket: "api-polling",
		windowSec: 60,
		limit: (req) => {
			if (!isApiKeyRequest(req)) return null;
			return req.auth?.userId ? 300 : 120;
		},
		methods: ["GET", "HEAD", "POST"],
		shouldApply: (req) => isPollingHeavyPath(req.path),
		apiOnly: true,
		failOpen: true
	})
);
app.use(
	createRateLimitMiddleware({
		bucket: "api-read",
		windowSec: 60,
		limit: (req) => {
			if (!isApiKeyRequest(req)) return null;
			return req.auth?.userId ? 120 : 60;
		},
		methods: ["GET", "HEAD"],
		shouldApply: (req) => !req.path.startsWith("/api/images/") && !isPollingHeavyPath(req.path),
		apiOnly: true,
		failOpen: true
	})
);
app.use(
	createRateLimitMiddleware({
		bucket: "api-images-read",
		windowSec: 60,
		limit: (req) => {
			if (!isApiKeyRequest(req)) return null;
			return req.auth?.userId ? 600 : 300;
		},
		methods: ["GET", "HEAD"],
		shouldApply: (req) => isApiKeyRequest(req) && req.path.startsWith("/api/images/"),
		apiOnly: true,
		failOpen: true
	})
);
app.use(
	createRateLimitMiddleware({
		bucket: "api-write",
		windowSec: 60,
		limit: (req) => {
			if (!isApiKeyRequest(req)) return null;
			return req.auth?.userId ? 40 : 20;
		},
		methods: ["POST", "PUT", "PATCH", "DELETE"],
		shouldApply: isApiKeyRequest,
		apiOnly: true,
		failOpen: true
	})
);
app.use(createPrsnCidPersistMiddleware(queries));
app.use(probabilisticSessionCleanup(queries));
app.use(
	createRateLimitMiddleware({
		bucket: "oauth-authorize",
		windowSec: 60,
		limit: 60,
		methods: ["GET"],
		shouldApply: (req) => req.path === "/oauth/authorize",
		apiOnly: false,
		failOpen: true
	})
);
app.use(
	createRateLimitMiddleware({
		bucket: "oauth-token",
		windowSec: 60,
		limit: 45,
		methods: ["POST"],
		shouldApply: (req) => req.path === "/oauth/token",
		apiOnly: false,
		failOpen: true
	})
);
app.use(createWelcomeGate(queries));

app.use(createSupabaseSessionRoutes({ queries }));
app.use(createOAuthIntegrationRoutes({ queries }));
app.use(createUserRoutes({ queries }));
app.use(createPresenceRoutes({ queries }));
app.use(createFollowsRoutes({ queries }));

app.use(createAdminRoutes({ queries, storage }));
app.use(createFeedRoutes({ queries }));
app.use(createExploreRoutes({ queries }));
app.use(createSuggestRoutes({ queries }));
app.use(createPromptInjectionsRoutes({ queries, storage }));
app.use(createCreateRoutes({ queries, storage }));
app.use(createImagesRoutes({ storage, queries }));
app.use(createCreationsRoutes({ queries }));
app.use(createLikesRoutes({ queries }));
app.use(createCommentsRoutes({ queries }));
app.use(createChatRoutes({ queries, storage }));
app.use(createShareRoutes({ queries, storage }));
app.use(createQRRoutes());
app.use(createProviderRoutes({ queries }));
app.use(createServersRoutes({ queries }));
app.use(createTemplatesRoutes({ queries }));
app.use(createBlogRoutes({ pagesDir, queries }));
app.use(createBlogAdminRoutes({ queries }));
app.use(createHelpRoutes({ pagesDir, queries }));
app.use(createPageRoutes({ queries, pagesDir, staticDir, storage }));
app.use(createTodoRoutes());
app.use(createPolicyRoutes());
app.use(createTryRoutes({ queries, storage }));
app.use(createYoutubeRoutes());
app.use(createVynlyRoutes({ queries, storage }));
app.use(createXRoutes());
app.use(createFeatureRequestRoutes({ queries }));

app.use(createUnauthorizedHandler(pagesDir));

if (process.env.NODE_ENV !== "production") {
	app.listen(port, () => {
		console.log(`Parascene dev server running on http://localhost:${port}`);
	});
}

// Log startup completion
if (shouldLogStartup()) {
	// console.log("[Startup] Express app configured and ready");
	// console.log("[Startup] Routes registered:", {
	// 	userRoutes: "✓",
	// 	adminRoutes: "✓",
	// 	feedRoutes: "✓",
	// 	exploreRoutes: "✓",
	// 	createRoutes: "✓",
	// 	creationsRoutes: "✓",
	// 	providerRoutes: "✓",
	// 	serversRoutes: "✓",
	// 	templatesRoutes: "✓",
	// 	pageRoutes: "✓"
	// });
}

export default app;
