#!/usr/bin/env node
/**
 * Flush visit pulse from Redis into DB for one US East partition day (UTC ISO in details).
 *
 * Usage:
 *   node scripts/analytics/visit-pulse-flush.cjs           # yesterday US East
 *   node scripts/analytics/visit-pulse-flush.cjs --day 2026-05-20
 *   node scripts/analytics/visit-pulse-flush.cjs --today   # today US East (partial)
 */

const { loadEnv } = require("../repo-root.cjs");
loadEnv();

function getArg(name) {
	const argv = process.argv.slice(2);
	const long = `--${name}`;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === long && argv[i + 1] != null && !argv[i + 1].startsWith("--")) {
			return String(argv[i + 1]).trim();
		}
		if (argv[i].startsWith(`${long}=`)) return argv[i].slice(long.length + 1).trim();
	}
	return "";
}

function hasFlag(name) {
	return process.argv.slice(2).includes(`--${name}`);
}

async function main() {
	const { runVisitPulseFlush } = await import("../../api_routes/utils/visitPulseFlush.js");
	let day = getArg("day");
	if (hasFlag("today")) {
		const { usEastDayKey } = await import("../../api_routes/utils/visitPulseCore.js");
		day = usEastDayKey();
	}
	const args = day ? { day } : {};
	const result = await runVisitPulseFlush({ args });
	console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
	console.error("[visit-pulse-flush]", err?.message || err);
	process.exit(1);
});
