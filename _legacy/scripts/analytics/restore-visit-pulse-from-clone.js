#!/usr/bin/env node
/**
 * Copy prsn_visit_pulse_days from a Supabase restore clone back into prod.
 *
 * Use after a bad flush zeroed historical rows. Restores a date range from clone
 * only where prod is empty (unique_visitors = 0). Does NOT touch days outside range
 * or prod rows that already have visitors (keeps Jun 9+ prod flushes).
 *
 * Setup (clone project → Settings → API):
 *   CLONE_SUPABASE_URL=https://xxxx.supabase.co
 *   CLONE_SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *
 * Prod uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env
 *
 *   node scripts/analytics/restore-visit-pulse-from-clone.js --dry-run
 *   node scripts/analytics/restore-visit-pulse-from-clone.js --apply
 */

import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../repo-root.cjs";

loadEnv();

const TABLE = "prsn_visit_pulse_days";
const FROM_DAY = process.env.PULSE_RESTORE_FROM || "2026-05-20";
const TO_DAY = process.env.PULSE_RESTORE_TO || "2026-06-08";

function requireEnv(name) {
	const v = process.env[name];
	if (!v) throw new Error(`Missing ${name}`);
	return v;
}

function client(url, key) {
	return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchDays(supabase, fromDay, toDay) {
	const { data, error } = await supabase
		.from(TABLE)
		.select(
			"day, unique_visitors, authed_visitors, anon_visitors, total_hits, total_active_blocks, flushed_at, details"
		)
		.gte("day", fromDay)
		.lte("day", toDay)
		.order("day");
	if (error) throw error;
	return data ?? [];
}

function hostLabel(url) {
	try {
		return new URL(url).hostname.split(".")[0];
	} catch {
		return url;
	}
}

async function main() {
	const apply = process.argv.includes("--apply");
	const dryRun = !apply;

	const prodUrl = requireEnv("SUPABASE_URL");
	const prodKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
	const cloneUrl = requireEnv("CLONE_SUPABASE_URL");
	const cloneKey = requireEnv("CLONE_SUPABASE_SERVICE_ROLE_KEY");

	const prod = client(prodUrl, prodKey);
	const clone = client(cloneUrl, cloneKey);

	console.log(`Prod:  ${hostLabel(prodUrl)}`);
	console.log(`Clone: ${hostLabel(cloneUrl)}`);
	console.log(`Range: ${FROM_DAY} → ${TO_DAY}`);
	console.log(dryRun ? "Mode: DRY RUN (pass --apply to write)\n" : "Mode: APPLY\n");

	const [cloneRows, prodRows] = await Promise.all([
		fetchDays(clone, FROM_DAY, TO_DAY),
		fetchDays(prod, FROM_DAY, TO_DAY)
	]);

	const prodByDay = new Map(prodRows.map((r) => [String(r.day), r]));
	const toRestore = [];

	for (const row of cloneRows) {
		const day = String(row.day);
		const prodRow = prodByDay.get(day);
		const cloneVisitors = Number(row.unique_visitors) || 0;
		const prodVisitors = Number(prodRow?.unique_visitors) || 0;

		if (cloneVisitors <= 0) {
			console.log(`skip ${day}: clone also empty`);
			continue;
		}
		if (prodVisitors > 0) {
			console.log(`skip ${day}: prod already has ${prodVisitors} unique (clone ${cloneVisitors})`);
			continue;
		}

		toRestore.push(row);
		console.log(
			`restore ${day}: unique ${cloneVisitors}, authed ${row.authed_visitors}, hits ${row.total_hits}`
		);
	}

	if (!toRestore.length) {
		console.log("\nNothing to restore in this range.");
		return;
	}

	console.log(`\n${toRestore.length} day(s) to restore.`);

	if (dryRun) {
		console.log("Re-run with --apply to upsert into prod.");
		return;
	}

	for (const row of toRestore) {
		const { error } = await prod.from(TABLE).upsert(row, { onConflict: "day" });
		if (error) throw error;
	}

	console.log("Done. Verifying prod…");
	const verify = await fetchDays(prod, FROM_DAY, TO_DAY);
	const stillZero = verify.filter((r) => Number(r.unique_visitors) === 0);
	if (stillZero.length) {
		console.warn(`Warning: ${stillZero.length} day(s) still zero in prod:`, stillZero.map((r) => r.day).join(", "));
	} else {
		console.log("All days in range have visitors in prod.");
	}
}

main().catch((err) => {
	console.error("[restore-visit-pulse-from-clone]", err?.message || err);
	process.exit(1);
});
