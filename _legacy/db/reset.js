/**
 * Wipes Supabase tables + storage and re-seeds demo users. Destructive — not exposed via npm scripts.
 *
 * Requires in .env (dev project only — never set on Vercel/production):
 *   ALLOW_DB_RESET=true
 *   RESET_SUPABASE_PROJECT_REF=<ref from Supabase Dashboard → Settings → General>
 *
 * Run explicitly:
 *   node db/reset.js
 */
import "dotenv/config";
import { openDb } from "./index.js";
import { seedDatabase } from "./seed.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function fail(message) {
	console.error(`[db/reset] ${message}`);
	process.exit(1);
}

/** @param {string} supabaseUrl */
function projectRefFromSupabaseUrl(supabaseUrl) {
	try {
		const host = new URL(supabaseUrl).hostname;
		const ref = host.split(".")[0];
		return ref && ref !== "localhost" ? ref : null;
	} catch {
		return null;
	}
}

function assertResetAllowed() {
	if (process.env.ALLOW_DB_RESET !== "true") {
		fail(
			"Refusing reset. Set ALLOW_DB_RESET=true in .env for a dev project only (do not set in production)."
		);
	}

	const expectedRef = String(process.env.RESET_SUPABASE_PROJECT_REF || "").trim();
	if (!expectedRef) {
		fail(
			"Refusing reset. Set RESET_SUPABASE_PROJECT_REF to your Supabase project ref (Dashboard → Settings → General)."
		);
	}

	const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
	if (!supabaseUrl) {
		fail("Refusing reset. SUPABASE_URL is not set.");
	}

	const actualRef = projectRefFromSupabaseUrl(supabaseUrl);
	if (!actualRef || actualRef !== expectedRef) {
		fail(
			`Refusing reset. SUPABASE_URL project ref "${actualRef || "(unknown)"}" does not match RESET_SUPABASE_PROJECT_REF "${expectedRef}".`
		);
	}

	if (process.env.VERCEL === "1" || process.env.VERCEL_ENV === "production") {
		fail("Refusing reset on Vercel or when VERCEL_ENV=production.");
	}

	if (process.env.NODE_ENV === "production" && process.env.ALLOW_DB_RESET_IN_PRODUCTION !== "true") {
		fail(
			"Refusing reset with NODE_ENV=production. Set ALLOW_DB_RESET_IN_PRODUCTION=true only if you are certain."
		);
	}

	if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
		fail("Refusing reset. SUPABASE_SERVICE_ROLE_KEY is required for table/storage cleanup.");
	}
}

function clearImagesDirectory(dirPath) {
	if (fs.existsSync(dirPath)) {
		const files = fs.readdirSync(dirPath);
		for (const file of files) {
			const filePath = path.join(dirPath, file);
			const stat = fs.statSync(filePath);
			if (stat.isFile()) {
				fs.unlinkSync(filePath);
			} else if (stat.isDirectory()) {
				clearImagesDirectory(filePath);
				fs.rmdirSync(filePath);
			}
		}
	}
}

assertResetAllowed();

try {
	const dbInstance = await openDb({ quiet: true });
	const { reset, storage } = dbInstance;

	console.error(
		`[db/reset] About to wipe project "${process.env.RESET_SUPABASE_PROJECT_REF}" (${process.env.SUPABASE_URL}). Ctrl+C to abort.`
	);

	if (storage?.clearAll) {
		await storage.clearAll();
	} else {
		const imagesDir = path.join(__dirname, "data", "images");
		clearImagesDirectory(path.join(imagesDir, "created"));
		clearImagesDirectory(path.join(imagesDir, "generated"));
	}

	if (typeof reset !== "function") {
		fail("Database reset is not available (missing reset()).");
	}

	await reset();
	await seedDatabase(dbInstance);
	console.error("[db/reset] Done. Seeded demo users (see db/seed.js).");
} catch (error) {
	console.error("[db/reset] Failed:", error?.message || error);
	process.exit(1);
}
