import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function reportsDevEnabled(env = process.env) {
	return env.NODE_ENV !== "production" && !env.VERCEL;
}

/**
 * Dev-only analytics overview. Same files the www server serves at /reports/.
 * Mount this before the SPA fallback so /reports/ is not rewritten to the app shell.
 */
export function createReportsRoutes({ root = repoRoot, enabled = reportsDevEnabled() } = {}) {
	if (!enabled) return null;
	const router = express.Router();
	const reportsAppDir = path.join(root, "scripts", "analytics", "overview");
	const reportsCssFile = path.join(root, "scripts", "analytics", "report.css");
	const reportsStoreFile = path.join(root, ".output", "overview", "store.json");
	router.get("/reports/store.json", (req, res) => res.sendFile(reportsStoreFile));
	router.get("/reports/report.css", (req, res) => res.sendFile(reportsCssFile));
	router.use("/reports", express.static(reportsAppDir, { index: "index.html" }));
	return router;
}
