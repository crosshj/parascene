#!/usr/bin/env node
/**
 * One-time migration: import markdown files under pages/blog/ into blog_posts as drafts.
 * Usage: node scripts/migrate-blog-to-db.mjs <author_user_id>
 *
 * Loads repo-root .env via dotenv, defaults DB_ADAPTER to supabase (set SUPABASE_* in .env).
 * Prefer SUPABASE_SERVICE_ROLE_KEY so inserts bypass RLS (same as the API server).
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import process from "process";
import { openDb } from "../db/index.js";
import { scanBlogDirectory } from "../lib/blog/parseAndScan.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");
const pagesDir = path.join(repoRoot, "pages");
const blogDir = path.join(pagesDir, "blog");

dotenv.config({ path: path.join(repoRoot, ".env") });
if (!process.env.DB_ADAPTER) {
	process.env.DB_ADAPTER = "supabase";
}

function requireSupabaseEnv() {
	const missing = ["SUPABASE_URL", "SUPABASE_ANON_KEY"].filter((k) => !process.env[k]?.trim());
	if (missing.length) {
		console.error(
			`Missing env (set in .env): ${missing.join(", ")}. See .env.example.`
		);
		process.exit(1);
	}
	if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
		console.warn(
			"Warning: SUPABASE_SERVICE_ROLE_KEY is unset. Inserts may fail if RLS blocks anon key. Set it in .env for migrations."
		);
	}
}

async function main() {
	const authorUserId = parseInt(process.argv[2], 10);
	if (!authorUserId || Number.isNaN(authorUserId)) {
		console.error("Usage: node scripts/migrate-blog-to-db.mjs <author_user_id>");
		process.exit(1);
	}

	if (process.env.DB_ADAPTER === "supabase") {
		requireSupabaseEnv();
	}

	const { queries } = await openDb({ quiet: true });
	const posts = await scanBlogDirectory(blogDir, blogDir);
	let inserted = 0;
	let skipped = 0;

	for (const p of posts) {
		const existing = await queries.selectBlogPostBySlugAny.get(p.slug);
		if (existing) {
			console.log("skip (exists):", p.slug);
			skipped += 1;
			continue;
		}
		const meta = {};
		if (p.date) meta.source_date = String(p.date);
		await queries.insertBlogPost.run({
			slug: p.slug,
			title: p.title || p.slug,
			description: p.description || "",
			body_md: p.content || "",
			status: "draft",
			author_user_id: authorUserId,
			updated_by_user_id: authorUserId,
			published_at: null,
			meta
		});
		console.log("inserted draft:", p.slug);
		inserted += 1;
	}

	console.log(`Done. Inserted ${inserted}, skipped ${skipped}.`);
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
