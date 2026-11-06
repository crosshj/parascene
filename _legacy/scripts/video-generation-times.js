#!/usr/bin/env node
/**
 * Generation-time stats for video creations, grouped by model.
 *
 * Uses meta.duration_ms (completed_at − started_at). Skips YouTube/import
 * rows that were never generated. Videos without a usable duration are counted
 * but excluded from timing stats.
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/video-generation-times.js
 *   node scripts/video-generation-times.js --blue
 *   node scripts/video-generation-times.js --server 6
 *   node scripts/video-generation-times.js --json
 *   node scripts/video-generation-times.js --min-count 5
 *   node scripts/video-generation-times.js --include-imports
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { PARASCENE_BLUE_SERVER_ID } from "../public/shared/generationDefaults.js";

const TABLE = "prsn_created_images";
const PAGE_SIZE = 1000;

function printUsage() {
	console.log(
		[
			"Generation-time stats for video creations, grouped by model.",
			"",
			"Usage:",
			"  node scripts/video-generation-times.js [options]",
			"",
			"Options:",
			"  --blue              Only Parascene Blue (server_id " + PARASCENE_BLUE_SERVER_ID + ")",
			"  --server <id|name>  Only this server (id, name, or \"blue\")",
			"  --json              Print JSON instead of a table",
			"  --min-count <n>     Hide models with fewer than n timed samples (default: 1)",
			"  --include-imports   Include imported videos (YouTube, etc.)",
			"  --help              Show this help"
		].join("\n")
	);
}

function parseArgs(argv) {
	const opts = {
		json: false,
		minCount: 1,
		includeImports: false,
		server: null,
		help: false
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			opts.help = true;
			continue;
		}
		if (arg === "--json") {
			opts.json = true;
			continue;
		}
		if (arg === "--include-imports") {
			opts.includeImports = true;
			continue;
		}
		if (arg === "--blue") {
			opts.server = "blue";
			continue;
		}
		if (arg === "--server") {
			const next = argv[i + 1];
			if (next == null || next.startsWith("-")) {
				throw new Error("Missing --server value");
			}
			opts.server = next;
			i++;
			continue;
		}
		if (arg === "--min-count") {
			const next = Number.parseInt(argv[i + 1], 10);
			if (!Number.isFinite(next) || next < 1) {
				throw new Error("Invalid --min-count value");
			}
			opts.minCount = next;
			i++;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return opts;
}

function resolveServerFilter(raw) {
	if (raw == null || raw === "") return null;
	const trimmed = String(raw).trim();
	const lower = trimmed.toLowerCase();
	if (lower === "blue" || lower === "parascene-blue" || lower === "parascene blue") {
		return {
			label: "Parascene Blue",
			id: PARASCENE_BLUE_SERVER_ID,
			name: "parascene blue"
		};
	}
	const asId = Number.parseInt(trimmed, 10);
	if (Number.isFinite(asId) && String(asId) === trimmed) {
		return { label: `server_id ${asId}`, id: asId, name: null };
	}
	return { label: trimmed, id: null, name: lower };
}

function matchesServer(meta, filter) {
	if (!filter) return true;
	const id = Number(meta?.server_id);
	if (filter.id != null && Number.isFinite(id) && id === filter.id) return true;
	const name = typeof meta?.server_name === "string" ? meta.server_name.trim().toLowerCase() : "";
	if (filter.name && name && (name === filter.name || name.includes(filter.name))) return true;
	return false;
}

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

function parseMeta(meta) {
	if (meta == null) return null;
	if (typeof meta === "object") return meta;
	if (typeof meta !== "string") return null;
	try {
		return JSON.parse(meta);
	} catch {
		return null;
	}
}

function isImport(meta) {
	return Boolean(meta?.import && typeof meta.import === "object");
}

function modelKey(meta) {
	const args = meta?.args && typeof meta.args === "object" ? meta.args : {};
	const model = args.model != null ? String(args.model).trim() : "";
	const version = args.version != null ? String(args.version).trim() : "";
	const method = meta?.method != null ? String(meta.method).trim() : "";
	if (model) return model;
	if (version) return `version:${version}`;
	if (method) return `method:${method}`;
	return "(unknown)";
}

function requestedClipSec(meta) {
	const args = meta?.args && typeof meta.args === "object" ? meta.args : {};
	for (const key of [
		"duration_seconds",
		"audio_duration_sec",
		"duration",
		"seconds",
		"num_seconds",
		"video_length",
		"length"
	]) {
		const n = Number(args[key]);
		if (Number.isFinite(n) && n > 0 && n <= 120) return Math.round(n * 10) / 10;
	}
	const frames = Number(args.num_frames);
	const fps = Number(args.fps);
	if (Number.isFinite(frames) && frames > 0 && Number.isFinite(fps) && fps > 0) {
		const sec = frames / fps;
		if (sec > 0 && sec <= 120) return Math.round(sec * 10) / 10;
	}
	return null;
}

function durationMsFromMeta(meta) {
	const stored = Number(meta?.duration_ms);
	if (Number.isFinite(stored) && stored >= 0) return stored;
	const started = Date.parse(meta?.started_at);
	const completed = Date.parse(meta?.completed_at);
	if (Number.isFinite(started) && Number.isFinite(completed) && completed >= started) {
		return completed - started;
	}
	return null;
}

function percentile(sortedArr, p) {
	if (!Array.isArray(sortedArr) || sortedArr.length === 0) return null;
	const idx = (p / 100) * (sortedArr.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sortedArr[lo];
	return sortedArr[lo] + (idx - lo) * (sortedArr[hi] - sortedArr[lo]);
}

function statsFor(durationsMs) {
	if (!Array.isArray(durationsMs) || durationsMs.length === 0) {
		return {
			count: 0,
			avg_ms: null,
			min_ms: null,
			max_ms: null,
			p50_ms: null,
			p95_ms: null
		};
	}
	const sorted = [...durationsMs].sort((a, b) => a - b);
	const n = sorted.length;
	const sum = sorted.reduce((a, b) => a + b, 0);
	return {
		count: n,
		avg_ms: Math.round(sum / n),
		min_ms: sorted[0],
		max_ms: sorted[n - 1],
		p50_ms: Math.round(percentile(sorted, 50) ?? 0),
		p95_ms: Math.round(percentile(sorted, 95) ?? 0)
	};
}

function formatSec(ms) {
	if (ms == null || !Number.isFinite(ms)) return "—";
	const sec = ms / 1000;
	if (sec < 10) return `${sec.toFixed(1)}s`;
	if (sec < 60) return `${Math.round(sec)}s`;
	let minutes = Math.floor(sec / 60);
	let rem = Math.round(sec % 60);
	if (rem === 60) {
		minutes += 1;
		rem = 0;
	}
	return `${minutes}m${String(rem).padStart(2, "0")}s`;
}

function pad(value, width, align = "left") {
	const str = String(value);
	if (str.length >= width) return str;
	const space = " ".repeat(width - str.length);
	return align === "right" ? space + str : str + space;
}

async function fetchVideoCreations(client) {
	const rows = [];
	let offset = 0;
	while (true) {
		const { data, error } = await client
			.from(TABLE)
			.select("id, status, meta, created_at")
			.eq("meta->>media_type", "video")
			.order("created_at", { ascending: false })
			.range(offset, offset + PAGE_SIZE - 1);
		if (error) throw error;
		if (!data || data.length === 0) break;
		rows.push(...data);
		if (data.length < PAGE_SIZE) break;
		offset += data.length;
	}
	return rows;
}

function analyze(rows, opts) {
	const serverFilter = resolveServerFilter(opts.server);
	let importSkipped = 0;
	let serverSkipped = 0;
	let notCompleted = 0;
	let missingDuration = 0;
	const timed = [];

	for (const row of rows) {
		const meta = parseMeta(row.meta);
		if (!meta) continue;
		if (!opts.includeImports && isImport(meta)) {
			importSkipped += 1;
			continue;
		}
		if (serverFilter && !matchesServer(meta, serverFilter)) {
			serverSkipped += 1;
			continue;
		}
		if (String(row.status || "").toLowerCase() !== "completed") {
			notCompleted += 1;
			continue;
		}
		const durationMs = durationMsFromMeta(meta);
		if (durationMs == null) {
			missingDuration += 1;
			continue;
		}
		timed.push({
			id: row.id,
			duration_ms: durationMs,
			model: modelKey(meta),
			clip_sec: requestedClipSec(meta)
		});
	}

	const byModel = new Map();
	let withClip = 0;
	for (const r of timed) {
		if (!byModel.has(r.model)) byModel.set(r.model, { durations: [], perSec: [] });
		const bucket = byModel.get(r.model);
		bucket.durations.push(r.duration_ms);
		if (r.clip_sec != null && r.clip_sec > 0) {
			withClip += 1;
			bucket.perSec.push(r.duration_ms / r.clip_sec);
		}
	}

	const byModelRows = [...byModel.entries()]
		.map(([key, bucket]) => {
			const wall = statsFor(bucket.durations);
			const perSec = statsFor(bucket.perSec);
			return {
				key,
				...wall,
				per_sec_count: perSec.count,
				per_sec_avg_ms: perSec.avg_ms,
				per_sec_p50_ms: perSec.p50_ms,
				per_sec_p95_ms: perSec.p95_ms
			};
		})
		.filter((s) => s.count >= opts.minCount)
		.sort((a, b) => (a.avg_ms ?? Infinity) - (b.avg_ms ?? Infinity));

	return {
		scanned: rows.length,
		timed: timed.length,
		importSkipped,
		serverSkipped,
		serverFilter: serverFilter ? serverFilter.label : null,
		notCompleted,
		missingDuration,
		withClip,
		byModel: byModelRows
	};
}

function printModelTable(rows) {
	if (rows.length === 0) {
		console.log("  (none)");
		console.log("");
		return;
	}
	const keyWidth = Math.min(
		48,
		Math.max(8, ...rows.map((r) => String(r.key).length))
	);
	const header = [
		pad("model", keyWidth),
		pad("n", 6, "right"),
		pad("avg", 8, "right"),
		pad("p50", 8, "right"),
		pad("p95", 8, "right"),
		pad("min", 8, "right"),
		pad("max", 8, "right"),
		pad("n/s", 5, "right"),
		pad("avg/s", 8, "right"),
		pad("p50/s", 8, "right"),
		pad("p95/s", 8, "right")
	].join("  ");
	console.log("  " + header);
	console.log("  " + "-".repeat(header.length));
	for (const s of rows) {
		const name = s.key.length > keyWidth ? s.key.slice(0, keyWidth - 1) + "…" : s.key;
		console.log(
			"  " +
				[
					pad(name, keyWidth),
					pad(s.count, 6, "right"),
					pad(formatSec(s.avg_ms), 8, "right"),
					pad(formatSec(s.p50_ms), 8, "right"),
					pad(formatSec(s.p95_ms), 8, "right"),
					pad(formatSec(s.min_ms), 8, "right"),
					pad(formatSec(s.max_ms), 8, "right"),
					pad(s.per_sec_count || 0, 5, "right"),
					pad(formatSec(s.per_sec_avg_ms), 8, "right"),
					pad(formatSec(s.per_sec_p50_ms), 8, "right"),
					pad(formatSec(s.per_sec_p95_ms), 8, "right")
				].join("  ")
		);
	}
	console.log("");
	console.log("  avg/s p50/s p95/s = generation time per requested output second (jobs with duration_seconds).");
	console.log("");
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printUsage();
		return;
	}

	const client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
	const rows = await fetchVideoCreations(client);
	const result = analyze(rows, opts);

	if (opts.json) {
		console.log(
			JSON.stringify(
				{
					generated_at: new Date().toISOString(),
					...result
				},
				null,
				2
			)
		);
		return;
	}

	console.log("");
	console.log("Video generation time by model");
	if (result.serverFilter) console.log(`  Server filter:           ${result.serverFilter}`);
	console.log(`  Videos scanned:          ${result.scanned}`);
	console.log(`  Imports skipped:         ${result.importSkipped}`);
	if (result.serverFilter) console.log(`  Other servers skipped:   ${result.serverSkipped}`);
	console.log(`  Not completed (skipped): ${result.notCompleted}`);
	console.log(`  Missing duration:        ${result.missingDuration}`);
	console.log(`  Timed samples:           ${result.timed}`);
	console.log(`  With requested length:   ${result.withClip}`);
	if (opts.minCount > 1) console.log(`  Min count filter:        ${opts.minCount}`);
	console.log("");

	printModelTable(result.byModel);
}

main().catch((err) => {
	console.error(err.message || err);
	process.exitCode = 1;
});
