#!/usr/bin/env node
/**
 * Analyze creation response times from the DB to find which server/method/model
 * combinations are fastest. Focus: Parascene server + Replicate method for try flow.
 *
 * Usage: node scripts/creation-response-times.js
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Edit the constants below to change filters or limit.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const TABLE = "prsn_created_images";
const PAGE_SIZE = 2000;

// Hardcoded filters — edit as needed
const SERVER_FILTER = "parascene";
const METHOD_FILTER = "replicate";
const MAX_CREATIONS = 100_000;

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

/** Derive a model key for grouping: meta.args.model, meta.args.version, or meta.method. */
function modelKey(meta) {
	const args = meta?.args && typeof meta.args === "object" ? meta.args : {};
	const model = args.model != null ? String(args.model).trim() : "";
	const version = args.version != null ? String(args.version).trim() : "";
	const method = meta?.method != null ? String(meta.method).trim() : "";
	if (model) return `model:${model}`;
	if (version) return `version:${version}`;
	if (method) return `method:${method}`;
	return "(unknown)";
}

function percentile(sortedArr, p) {
	if (!Array.isArray(sortedArr) || sortedArr.length === 0) return null;
	const idx = (p / 100) * (sortedArr.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sortedArr[lo];
	return sortedArr[lo] + (idx - lo) * (sortedArr[hi] - sortedArr[lo]);
}

async function fetchCompletedCreations(client, limit) {
	const rows = [];
	let offset = 0;
	while (rows.length < limit) {
		const { data, error } = await client
			.from(TABLE)
			.select("id, meta, created_at")
			.eq("status", "completed")
			.not("meta", "is", null)
			.range(offset, offset + PAGE_SIZE - 1)
			.order("created_at", { ascending: false });
		if (error) throw error;
		if (!data || data.length === 0) break;
		rows.push(...data);
		if (data.length < PAGE_SIZE) break;
		offset += data.length;
		if (rows.length >= limit) break;
	}
	return rows.slice(0, limit);
}

function run(client) {
	return fetchCompletedCreations(client, MAX_CREATIONS).then((rows) => {
		const serverLower = SERVER_FILTER.toLowerCase();
		const methodLower = METHOD_FILTER.toLowerCase();

		const withDuration = [];
		for (const row of rows) {
			const meta = parseMeta(row.meta);
			if (!meta) continue;
			const durationMs = meta.duration_ms;
			if (durationMs == null || !Number.isFinite(Number(durationMs))) continue;
			const serverName = (meta.server_name != null ? String(meta.server_name) : "").toLowerCase();
			const methodName = (meta.method_name != null ? String(meta.method_name) : "").toLowerCase();
			const methodKeyVal = (meta.method != null ? String(meta.method) : "").toLowerCase();
			const matchServer = !serverLower || serverName.includes(serverLower);
			const matchMethod =
				!methodLower ||
				methodName.includes(methodLower) ||
				methodKeyVal.includes(methodLower);
			if (matchServer && matchMethod) {
				withDuration.push({
					id: row.id,
					duration_ms: Number(durationMs),
					modelKey: modelKey(meta)
				});
			}
		}

		// Group by model key
		const byModel = new Map();
		for (const r of withDuration) {
			const key = r.modelKey;
			if (!byModel.has(key)) byModel.set(key, []);
			byModel.get(key).push(r.duration_ms);
		}

		const stats = [];
		for (const [key, durations] of byModel.entries()) {
			const sorted = [...durations].sort((a, b) => a - b);
			const n = sorted.length;
			const sum = sorted.reduce((a, b) => a + b, 0);
			stats.push({
				model: key,
				count: n,
				avg_ms: Math.round(sum / n),
				min_ms: sorted[0],
				max_ms: sorted[n - 1],
				p50_ms: Math.round(percentile(sorted, 50) ?? 0),
				p95_ms: Math.round(percentile(sorted, 95) ?? 0)
			});
		}

		stats.sort((a, b) => a.avg_ms - b.avg_ms);
		return { stats, totalAnalyzed: rows.length, totalMatched: withDuration.length };
	});
}

function main() {
	const supabaseUrl = requireEnv("SUPABASE_URL");
	const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
	const client = createClient(supabaseUrl, serviceKey);

	run(client)
		.then(({ stats, totalAnalyzed, totalMatched }) => {
			console.log("");
			console.log("Creation response time analysis");
			console.log("  Server filter: " + (SERVER_FILTER || "(any)"));
			console.log("  Method filter: " + (METHOD_FILTER || "(any)"));
			console.log("  Creations scanned: " + totalAnalyzed);
			console.log("  Creations with duration (matching filters): " + totalMatched);
			console.log("");

			if (stats.length === 0) {
				console.log("No matching creations with duration_ms in meta.");
				return;
			}

			const col = (v, w) => String(v).padStart(w);
			const header =
				"  " +
				["model", "count", "avg_ms", "min", "max", "p50", "p95"].map((h) => h.padEnd(12)).join(" ");
			console.log(header);
			console.log("  " + "-".repeat(header.length - 2));

			for (const s of stats) {
				const modelStr = s.model.length > 28 ? s.model.slice(0, 25) + "…" : s.model;
				console.log(
					"  " +
						modelStr.padEnd(28) +
						" " +
						col(s.count, 6) +
						" " +
						col(s.avg_ms, 8) +
						" " +
						col(s.min_ms, 6) +
						" " +
						col(s.max_ms, 6) +
						" " +
						col(s.p50_ms, 6) +
						" " +
						col(s.p95_ms, 6)
				);
			}

			console.log("");
			const best = stats[0];
			console.log(
				"Fastest by average: " +
					best.model +
					" (avg " +
					best.avg_ms +
					" ms, n=" +
					best.count +
					"). Consider this for the try flow if quality is acceptable."
			);
			console.log("");
		})
		.catch((err) => {
			console.error(err);
			process.exit(1);
		});
}

main();
