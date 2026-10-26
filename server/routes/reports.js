import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function reportsDevEnabled(env = process.env) {
	return !env.VERCEL && (env.NODE_ENV !== "production" || env.LOCAL_REPORTS_ENABLED === "1");
}

/**
 * Local analytics overview, served as HTML at /reports/ by the app server.
 * Mount this before the SPA fallback so report requests stay out of the app shell.
 */
export function createReportsRoutes({ root = repoRoot, enabled = reportsDevEnabled() } = {}) {
	if (!enabled) return null;
	const router = express.Router();
	const overview = express.Router();
	const reportsAppDir = path.join(root, "scripts", "analytics", "overview");
	const reportsCssFile = path.join(root, "scripts", "analytics", "report.css");
	const reportsStoreFile = path.join(root, ".output", "overview", "store.json");
	overview.get("/store.json", (req, res, next) => {
		res.set("Cache-Control", "no-store");
		res.sendFile(reportsStoreFile, (error) => {
			if (!error) return;
			if (error.code === "ENOENT") {
				return res.status(404).json({
					error: "Report data store not found. Run node scripts/analytics/overview-refresh.js, then reload."
				});
			}
			next(error);
		});
	});
	overview.get("/report.css", (req, res) => res.sendFile(reportsCssFile));
	overview.use(express.static(reportsAppDir, { index: "index.html", fallthrough: false }));
	overview.use((error, req, res, next) => {
		if (error.status !== 404 || res.headersSent) return next(error);
		res.status(404).json({ error: "Report resource not found" });
	});
	router.use("/reports", (req, res, next) => {
		const remote = req.socket.remoteAddress;
		if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) {
			return res.status(404).json({ error: "Report resource not found" });
		}
		next();
	}, overview);
	return router;
}
