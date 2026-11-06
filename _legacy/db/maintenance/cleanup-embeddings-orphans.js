#!/usr/bin/env node
/**
 * Cleanup semantic embeddings that no longer belong to a published creation.
 *
 * Candidate rule:
 * - Keep embeddings only when prsn_created_images.published === true (or 1)
 * - Delete embeddings when the creation is missing, or published is false.
 *
 * Usage:
 *   node db/maintenance/cleanup-embeddings-orphans.js dr [--batch-size 1000] [--max-embeddings 50000]
 *   node db/maintenance/cleanup-embeddings-orphans.js exec [--batch-size 1000] [--max-embeddings 50000]
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const EMBEDDINGS_TABLE = "prsn_created_embeddings";
const IMAGES_TABLE = "prsn_created_images";

function printUsage() {
	console.log(
		[
			"Cleanup embeddings that exist without a published creation.",
			"",
			"Usage:",
			"  node db/maintenance/cleanup-embeddings-orphans.js <dr|exec> [--batch-size 1000] [--max-embeddings 50000]",
			"",
			"Modes:",
			"  dr    Dry run: report candidates only",
			"  exec  Execute: delete stale embeddings",
			"",
			"Env:",
			"  SUPABASE_URL",
			"  SUPABASE_SERVICE_ROLE_KEY",
			"",
			"Options:",
			"  --batch-size <n>       How many embedding rows to scan per batch (default: 1000)",
			"  --max-embeddings <n>  Stop scanning after this many embedding rows (default: none)",
			"  --help                 Show this help",
			""
		].join("\n")
	);
}

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

function toNumberOrNull(v) {
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function isPublishedValue(v) {
	// published is boolean in schema, but keep this loose for safety when data comes back as 1/0.
	return v === true || v === 1;
}

function parseArgs(argv) {
	const opts = {
		mode: "dr",
		batchSize: 1000,
		maxEmbeddings: null,
		help: false
	};

	const positional = argv.filter((a) => !String(a).startsWith("--"));
	if (positional.length >= 1) {
		const m = String(positional[0]).trim().toLowerCase();
		if (m === "dr" || m === "exec") opts.mode = m;
		else if (m === "dry" || m === "dry-run" || m === "dryrun") opts.mode = "dr";
		else throw new Error(`Unknown mode: ${positional[0]}`);
	}

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			opts.help = true;
			continue;
		}

		if (arg === "--mode") {
			const next = String(argv[i + 1] ?? "").toLowerCase().trim();
			if (next !== "dr" && next !== "exec") throw new Error(`Invalid --mode: ${next}`);
			opts.mode = next;
			i++;
			continue;
		}

		if (arg === "--batch-size") {
			const n = toNumberOrNull(argv[i + 1]);
			if (n == null || n < 1) throw new Error("Invalid --batch-size");
			opts.batchSize = Math.floor(n);
			i++;
			continue;
		}

		if (arg === "--max-embeddings") {
			const n = toNumberOrNull(argv[i + 1]);
			if (n == null || n < 1) throw new Error("Invalid --max-embeddings");
			opts.maxEmbeddings = Math.floor(n);
			i++;
			continue;
		}

		// Allow mode to be the first positional argument even if we don't parse it.
		if (arg === "dr" || arg === "exec") continue;

		if (String(arg).startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
	}

	if (opts.mode !== "dr" && opts.mode !== "exec") throw new Error(`Invalid mode: ${opts.mode}`);
	return opts;
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printUsage();
		return;
	}

	const supabaseUrl = requireEnv("SUPABASE_URL");
	const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
	const supabase = createClient(supabaseUrl, serviceKey);

	console.log(`Embedding cleanup mode: ${opts.mode.toUpperCase()}`);
	console.log(`Scanning batches of ${opts.batchSize} embedding rows.`);
	if (opts.maxEmbeddings != null) console.log(`Max embeddings to scan: ${opts.maxEmbeddings}`);

	let lastCreatedImageId = 0;
	let scanned = 0;
	let candidateCount = 0;
	let deletedCount = 0;
	const candidateExamples = [];
	const MAX_EXAMPLES = 25;

	while (true) {
		const { data, error } = await supabase
			.from(EMBEDDINGS_TABLE)
			.select("created_image_id")
			.gt("created_image_id", lastCreatedImageId)
			.order("created_image_id", { ascending: true })
			.limit(opts.batchSize);

		if (error) throw error;
		const rows = data ?? [];
		if (rows.length === 0) break;

		const idsAll = rows
			.map((r) => Number(r?.created_image_id))
			.filter((id) => Number.isFinite(id) && id > 0);

		if (idsAll.length === 0) {
			lastCreatedImageId = lastCreatedImageId + 1;
			continue;
		}

		const remaining = opts.maxEmbeddings == null ? null : Math.max(opts.maxEmbeddings - scanned, 0);
		const ids = remaining == null ? idsAll : idsAll.slice(0, remaining);
		if (ids.length === 0) break;

		scanned += ids.length;
		lastCreatedImageId = Math.max(...ids);

		// Fetch only published=true creations for this batch.
		const { data: imgRows, error: imgErr } = await supabase
			.from(IMAGES_TABLE)
			.select("id, published")
			.in("id", ids);
		if (imgErr) throw imgErr;

		const publishedSet = new Set(
			(imgRows ?? [])
				.map((r) => ({ id: Number(r?.id), published: r?.published }))
				.filter((r) => Number.isFinite(r.id) && isPublishedValue(r.published))
				.map((r) => r.id)
		);

		const toDelete = ids.filter((id) => !publishedSet.has(id));
		candidateCount += toDelete.length;

		if (candidateExamples.length < MAX_EXAMPLES && toDelete.length > 0) {
			for (const id of toDelete) {
				candidateExamples.push(id);
				if (candidateExamples.length >= MAX_EXAMPLES) break;
			}
		}

		if (opts.mode === "exec" && toDelete.length > 0) {
			const { error: delErr } = await supabase.from(EMBEDDINGS_TABLE).delete().in("created_image_id", toDelete);
			if (delErr) throw delErr;
			deletedCount += toDelete.length;
		}

		if (opts.maxEmbeddings != null && scanned >= opts.maxEmbeddings) break;
	}

	console.log("");
	console.log(
		{
			scanned_embeddings_rows: scanned,
			candidate_embeddings_to_delete: candidateCount,
			deleted_embeddings_rows: opts.mode === "exec" ? deletedCount : 0,
			candidate_examples_created_image_ids: candidateExamples
		}
	);
}

main().catch((err) => {
	console.error(err?.message || err);
	process.exit(1);
});

