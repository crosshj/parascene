#!/usr/bin/env node
/**
 * Standalone loopback server for the finance ledger.
 * The app serves the same page at /finance/ in local development.
 *
 * Usage: node scripts/finance/server.js
 * The ledger owner is user 219. FINANCE_PORT defaults to 2391.
 */

import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { REPO_ROOT, loadEnv } from "../repo-root.cjs";
import { createFinanceLedger } from "../../server/services/finance/ledger.js";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(REPO_ROOT, ".output", "finance", "backups");
const PORT = Number(process.env.FINANCE_PORT || 2391);

function requiredEnv(name) {
	const value = String(process.env[name] || "").trim();
	if (!value) throw new Error(`Missing ${name}`);
	return value;
}

const client = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const ledger = createFinanceLedger({ client, backupDir: BACKUP_DIR });
const loaded = await ledger.read();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname, { index: "index.html" }));
app.get("/api/ledger", async (_req, res) => res.json(await ledger.read()));
app.put("/api/ledger", async (req, res) => {
	try {
		res.json(await ledger.write(req.body));
	} catch (error) {
		console.error("[finance] save failed", error);
		res.status(500).json({ error: error?.message || "Could not save ledger" });
	}
});
app.listen(PORT, "127.0.0.1", () => {
	console.log(`[finance] http://127.0.0.1:${PORT}`);
	console.log(`[finance] self-DM message ${loaded.storage.messageId}; backups: ${BACKUP_DIR}`);
});
