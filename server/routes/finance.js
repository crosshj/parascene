import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFinanceLedger } from "../services/finance/ledger.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function financeDevEnabled(env = process.env) {
	return !env.VERCEL && (env.NODE_ENV !== "production" || env.LOCAL_FINANCE_ENABLED === "1");
}

/**
 * Local finance ledger, served as HTML at /finance/ by the app server.
 * Mount this before the SPA fallback so finance requests stay out of the app shell.
 */
export function createFinanceRoutes({
	root = repoRoot,
	enabled = financeDevEnabled(),
	client = null,
	ledger = null,
	env = process.env
} = {}) {
	if (!enabled) return null;
	const router = express.Router();
	const indexFile = path.join(root, "scripts", "finance", "index.html");
	const store = ledger || createFinanceLedger({
		client,
		backupDir: path.join(root, ".output", "finance", "backups"),
		env
	});
	const finance = express.Router();
	finance.use(express.json({ limit: "2mb" }));
	finance.get(["/", "/index.html"], (req, res, next) => {
		res.set("Cache-Control", "no-store");
		res.sendFile(indexFile, (error) => {
			if (!error) return;
			if (error.code === "ENOENT") return res.status(404).json({ error: "Finance resource not found" });
			next(error);
		});
	});
	finance.get("/api/ledger", async (req, res) => {
		try {
			res.set("Cache-Control", "no-store");
			res.json(await store.read());
		} catch (error) {
			res.status(500).json({ error: error?.message || "Could not load ledger" });
		}
	});
	finance.put("/api/ledger", async (req, res) => {
		try {
			res.json(await store.write(req.body));
		} catch (error) {
			console.error("[finance] save failed", error);
			res.status(500).json({ error: error?.message || "Could not save ledger" });
		}
	});
	finance.use((req, res) => {
		res.status(404).json({ error: "Finance resource not found" });
	});
	router.use("/finance", (req, res, next) => {
		if (!LOOPBACK.has(req.socket?.remoteAddress)) {
			return res.status(404).json({ error: "Finance resource not found" });
		}
		const url = req.originalUrl || req.url || "";
		if (url === "/finance" || url.startsWith("/finance?")) {
			const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
			return res.redirect(301, `/finance/${query}`);
		}
		next();
	}, finance);
	return router;
}
