#!/usr/bin/env node
/**
 * Upsert prsn_visit_pulse_days from a Table Editor CSV export into prod.
 * Only overwrites rows where prod unique_visitors = 0 (keeps newer Jun 9+ flushes).
 *
 *   node scripts/analytics/restore-visit-pulse-from-csv.js pulse_bak.csv --dry-run
 *   node scripts/analytics/restore-visit-pulse-from-csv.js pulse_bak.csv --apply
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { loadEnv, REPO_ROOT } from "../repo-root.cjs";

loadEnv();

const TABLE = "prsn_visit_pulse_days";

function parseCsvLine(line) {
	const m = line.match(/^([^,]+),(\d+),(\d+),(\d+),(\d+),(\d+),([^,]+),(.+)$/);
	if (!m) throw new Error(`Could not parse row: ${line.slice(0, 80)}…`);
	const detailsRaw = m[8];
	const detailsStr = detailsRaw.startsWith('"')
		? detailsRaw.slice(1, -1).replace(/""/g, '"')
		: detailsRaw;
	return {
		day: m[1],
		unique_visitors: Number(m[2]),
		authed_visitors: Number(m[3]),
		anon_visitors: Number(m[4]),
		total_hits: Number(m[5]),
		total_active_blocks: Number(m[6]),
		flushed_at: m[7],
		details: JSON.parse(detailsStr)
	};
}

function parseCsv(filePath) {
	const text = fs.readFileSync(filePath, "utf8");
	const lines = text.split(/\r?\n/).filter((l) => l.trim());
	const header = lines[0];
	if (!header.startsWith("day,")) throw new Error("Expected CSV header starting with day,");
	return lines.slice(1).map(parseCsvLine);
}

async function main() {
	const apply = process.argv.includes("--apply");
	const csvArg = process.argv.find((a) => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]);
	const csvPath = path.resolve(csvArg || path.join(REPO_ROOT, "pulse_bak.csv"));

	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

	const rows = parseCsv(csvPath);
	const supabase = createClient(url, key, { auth: { persistSession: false } });

	const days = rows.map((r) => r.day);
	const { data: prodRows, error: fetchError } = await supabase
		.from(TABLE)
		.select("day, unique_visitors")
		.in("day", days);
	if (fetchError) throw fetchError;

	const prodByDay = new Map((prodRows ?? []).map((r) => [String(r.day), Number(r.unique_visitors) || 0]));
	const toRestore = [];

	for (const row of rows) {
		if (row.unique_visitors <= 0) {
			console.log(`skip ${row.day}: backup row empty`);
			continue;
		}
		const prodVisitors = prodByDay.get(row.day) ?? 0;
		if (prodVisitors > 0) {
			console.log(`skip ${row.day}: prod already has ${prodVisitors} unique (backup ${row.unique_visitors})`);
			continue;
		}
		toRestore.push(row);
		console.log(`restore ${row.day}: unique ${row.unique_visitors}`);
	}

	console.log(`\n${toRestore.length} day(s) to restore from ${path.basename(csvPath)}.`);

	if (!toRestore.length) return;

	if (!apply) {
		console.log("Re-run with --apply to upsert into prod.");
		return;
	}

	for (const row of toRestore) {
		const { error } = await supabase.from(TABLE).upsert(row, { onConflict: "day" });
		if (error) throw error;
	}

	console.log("Done.");
}

main().catch((err) => {
	console.error("[restore-visit-pulse-from-csv]", err?.message || err);
	process.exit(1);
});
