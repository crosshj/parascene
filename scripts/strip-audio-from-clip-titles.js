#!/usr/bin/env node
/**
 * Remove the "Audio from " prefix from prsn_audio_clips titles where present.
 *
 * Usage:
 *   node scripts/strip-audio-from-clip-titles.js [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./repo-root.cjs";

loadEnv();

const TABLE = "prsn_audio_clips";
const PREFIX = "Audio from ";
const dryRun = process.argv.includes("--dry-run");

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

function cleanTitle(title) {
	if (typeof title !== "string" || !title.startsWith(PREFIX)) return null;
	const cleaned = title.slice(PREFIX.length).trim();
	return cleaned || null;
}

async function main() {
	const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));

	console.log(
		dryRun
			? `[dry-run] Removing "${PREFIX}" prefix from audio clip titles`
			: `Removing "${PREFIX}" prefix from audio clip titles`
	);

	let lastId = 0;
	const pageSize = 100;
	let scanned = 0;
	let updated = 0;
	let skipped = 0;

	while (true) {
		const { data, error } = await supabase
			.from(TABLE)
			.select("id, title")
			.gt("id", lastId)
			.order("id", { ascending: true })
			.limit(pageSize);

		if (error) throw error;
		const rows = data ?? [];
		if (!rows.length) break;

		for (const row of rows) {
			scanned += 1;
			lastId = Number(row.id);

			const newTitle = cleanTitle(row.title);
			if (!newTitle) {
				skipped += 1;
				continue;
			}

			if (dryRun) {
				console.log(`  [dry-run] clip ${row.id}: "${row.title}" → "${newTitle}"`);
			} else {
				const { error: updateError } = await supabase
					.from(TABLE)
					.update({ title: newTitle, updated_at: new Date().toISOString() })
					.eq("id", row.id);
				if (updateError) throw updateError;
				console.log(`  clip ${row.id}: "${row.title}" → "${newTitle}"`);
			}
			updated += 1;
		}

		if (rows.length < pageSize) break;
	}

	console.log(`Done. scanned=${scanned} updated=${updated} skipped=${skipped}`);
}

main().catch((err) => {
	console.error(err?.message || err);
	process.exit(1);
});
