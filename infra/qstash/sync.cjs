#!/usr/bin/env node
/**
 * Sync all QStash schedules from infra/qstash/schedules.cjs to Upstash.
 *
 * Requires .env: UPSTASH_QSTASH_TOKEN, UPSTASH_QSTASH_URL
 *
 * Usage:
 *   node infra/qstash/sync.cjs
 *   node infra/qstash/sync.cjs --dry-run
 *   node infra/qstash/sync.cjs --only parascene-visit-pulse-flush
 */

const path = require("path");
const { loadEnv } = require(path.join(__dirname, "../../scripts/repo-root.cjs"));
const { QSTASH_SCHEDULES } = require("./schedules.cjs");

loadEnv();

function hasFlag(name) {
	return process.argv.slice(2).includes(`--${name}`);
}

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

/**
 * @param {import('./schedules.cjs').QSTASH_SCHEDULES[number]} def
 * @param {string} destination
 */
async function upsertSchedule(def, destination, { token, qstashBase, dryRun }) {
	const scheduleUrl = `${qstashBase}/v2/schedules/${destination}`;
	const hasBody = def.body !== undefined;
	const body = hasBody ? def.body : null;

	console.log(`\n${def.id} — ${def.label}`);
	console.log(`  cron:        ${def.cron}`);
	console.log(`  destination: ${destination}`);
	console.log(`  body:        ${hasBody ? JSON.stringify(body) : "(none)"}`);

	if (dryRun) return { id: def.id, dryRun: true };

	const headers = {
		Authorization: `Bearer ${token}`,
		"Upstash-Cron": def.cron,
		"Upstash-Schedule-Id": def.id,
		"Upstash-Method": def.method || "POST"
	};
	if (hasBody) {
		headers["Content-Type"] = "application/json";
	}

	const res = await fetch(scheduleUrl, {
		method: "POST",
		headers,
		body: hasBody ? JSON.stringify(body) : undefined
	});

	const text = await res.text();
	let parsed = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = text;
	}

	if (!res.ok) {
		throw new Error(`${def.id}: Upstash ${res.status} — ${JSON.stringify(parsed || text)}`);
	}

	console.log(`  ok:          ${JSON.stringify(parsed)}`);
	return { id: def.id, scheduleId: parsed?.scheduleId ?? def.id };
}

async function main() {
	const token = process.env.UPSTASH_QSTASH_TOKEN?.trim();
	const qstashBase = process.env.UPSTASH_QSTASH_URL?.replace(/\/$/, "");
	if (!token || !qstashBase) {
		console.error("Missing UPSTASH_QSTASH_TOKEN or UPSTASH_QSTASH_URL in .env");
		process.exit(1);
	}

	const dryRun = hasFlag("dry-run");
	const only = getArg("only");
	let defs = QSTASH_SCHEDULES;
	if (only) {
		defs = defs.filter((d) => d.id === only);
		if (!defs.length) {
			console.error(`No schedule with id "${only}". Known: ${QSTASH_SCHEDULES.map((d) => d.id).join(", ")}`);
			process.exit(1);
		}
	}

	const { getQStashCallbackBaseUrl } = await import("../../api_routes/utils/url.js");
	const apiBase = getQStashCallbackBaseUrl();

	console.log("QStash schedule sync");
	console.log(`  api base: ${apiBase}`);
	console.log(`  count:    ${defs.length}${dryRun ? " (dry-run)" : ""}`);

	const results = [];
	for (const def of defs) {
		const destination = new URL(def.destinationPath, apiBase).toString();
		results.push(await upsertSchedule(def, destination, { token, qstashBase, dryRun }));
	}

	console.log(`\nDone.${dryRun ? " (dry-run — nothing sent to Upstash)" : ""}`);
}

main().catch((err) => {
	console.error("[infra/qstash/sync]", err?.message || err);
	process.exit(1);
});
