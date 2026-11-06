#!/usr/bin/env node
/**
 * Rebuild square (`?variant=thumbnail`) and fit (`?variant=fit`) thumbs as WebP.
 * Storage keys stay the same. Originals stay. Group rows are excluded (no
 * uploaded file; they reuse cover-source thumbs). Default always rewrites
 * thumbs — probing existing WebP costs extra downloads on every row.
 *
 * Usage:
 *   node scripts/backfill-created-thumbnails-webp.js --dry-run
 *   node scripts/backfill-created-thumbnails-webp.js
 *   node scripts/backfill-created-thumbnails-webp.js --skip-existing
 *   node scripts/backfill-created-thumbnails-webp.js --before-id 13976
 *   node scripts/backfill-created-thumbnails-webp.js --limit 50
 *   node scripts/backfill-created-thumbnails-webp.js --respawn-min 40
 *   node scripts/backfill-created-thumbnails-webp.js --respawn-min 0
 *
 * Default --respawn-min 40: a tiny supervisor keeps this terminal and starts a
 * fresh Node worker every N minutes (avoids the long-run slowdown).
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { loadEnv } from "./repo-root.cjs";
import {
	buildFitThumbnailBuffer,
	buildSquareThumbnailBuffer,
	fitThumbnailStorageKey,
	shouldGenerateFitThumbnail
} from "../api_routes/utils/fitThumbnail.js";
import { resolveCreatedImageStorageFilename } from "../api_routes/utils/resolveCreatedImageStorageFilename.js";

loadEnv();

const CREATED_TABLE = "prsn_created_images";
const CREATED_BUCKET = "prsn_created-images";
const THUMB_BUCKET = "prsn_created-images-thumbnails";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipExisting = args.includes("--skip-existing");
const limitArg = readFlagValue(args, "--limit");
const maxRows = limitArg != null ? Number(limitArg) : Infinity;
const beforeIdArg = readFlagValue(args, "--before-id");
const beforeId = beforeIdArg != null ? Number(beforeIdArg) : null;
const respawnMinArg = readFlagValue(args, "--respawn-min");
const respawnMin = respawnMinArg != null ? Number(respawnMinArg) : 40;
const respawnMs = Number.isFinite(respawnMin) && respawnMin > 0 ? respawnMin * 60 * 1000 : 0;
const isWorker = process.env.BACKFILL_THUMB_WORKER === "1";
const pageSize = 100;
const RESPAWN_EXIT = 75;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const CURSOR_FILE = path.join(os.tmpdir(), "parascene-backfill-created-thumbs-cursor");

function readFlagValue(list, flag) {
	const idx = list.indexOf(flag);
	if (idx < 0) return null;
	const value = list[idx + 1];
	if (!value || value.startsWith("--")) return null;
	return value;
}

function writeResumeCursor(id) {
	fs.writeFileSync(CURSOR_FILE, String(id), "utf8");
}

function readResumeCursor() {
	try {
		const n = Number(fs.readFileSync(CURSOR_FILE, "utf8").trim());
		return Number.isFinite(n) && n > 0 ? n : null;
	} catch {
		return null;
	}
}

function argvWithBeforeId(nextBeforeId) {
	const argv = [];
	const src = process.argv.slice(2);
	for (let i = 0; i < src.length; i += 1) {
		if (src[i] === "--before-id") {
			i += 1;
			continue;
		}
		argv.push(src[i]);
	}
	if (Number.isFinite(nextBeforeId) && nextBeforeId > 0) {
		argv.push("--before-id", String(nextBeforeId));
	}
	return argv;
}

function runWorker(nextBeforeId) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [SCRIPT_PATH, ...argvWithBeforeId(nextBeforeId)], {
			stdio: "inherit",
			env: { ...process.env, BACKFILL_THUMB_WORKER: "1" }
		});
		child.on("error", reject);
		child.on("exit", (code) => resolve(code ?? 1));
	});
}

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

function formatBytes(n) {
	if (!Number.isFinite(n)) return "?";
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms) {
	const s = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
	if (m > 0) return `${m}m${String(sec).padStart(2, "0")}s`;
	return `${sec}s`;
}

function formatPerMin(count, ms) {
	if (!Number.isFinite(ms) || ms < 1000) return "—/min";
	return `${((count / ms) * 60000).toFixed(1)}/min`;
}

function formatErr(err) {
	if (!err) return "unknown error";
	const msg = typeof err.message === "string" ? err.message.trim() : "";
	if (msg && msg !== "{}") return msg;
	try {
		const json = JSON.stringify(err);
		if (json && json !== "{}") return json;
	} catch {
		// ignore
	}
	return String(err);
}

async function download(supabase, bucket, key) {
	const { data, error } = await supabase.storage.from(bucket).download(key);
	if (error || !data) throw new Error(formatErr(error) || `not found in ${bucket}: ${key}`);
	return Buffer.from(await data.arrayBuffer());
}

async function isWebpBuffer(buffer) {
	try {
		const meta = await sharp(buffer, { failOn: "none" }).metadata();
		return meta.format === "webp";
	} catch {
		return false;
	}
}

async function main() {
	const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
		auth: { persistSession: false }
	});

	const startCursor =
		Number.isFinite(beforeId) && beforeId > 0 ? beforeId : Number.POSITIVE_INFINITY;

	let remainingHint = null;
	{
		let remainingQuery = supabase
			.from(CREATED_TABLE)
			.select("id", { count: "exact", head: true })
			.eq("status", "completed")
			.is("unavailable_at", null)
			.not("filename", "like", "group/%");
		if (Number.isFinite(startCursor) && startCursor < Number.POSITIVE_INFINITY) {
			remainingQuery = remainingQuery.lt("id", startCursor);
		}
		const { count, error: countErr } = await remainingQuery;
		if (!countErr && Number.isFinite(count)) remainingHint = count;
	}

	console.log(
		[
			dryRun ? "[dry-run]" : "[write]",
			"created thumbs → webp, newest first",
			skipExisting ? "(skip existing webp)" : "(rewrite all)",
			Number.isFinite(startCursor) && startCursor < Number.POSITIVE_INFINITY
				? `before-id=${startCursor}`
				: "",
			Number.isFinite(maxRows) ? `limit=${maxRows}` : "",
			respawnMs > 0 ? `respawn=${respawnMin}m` : "respawn=off",
			remainingHint != null ? `left≈${remainingHint}` : ""
		]
			.filter(Boolean)
			.join(" ")
	);

	const startedAt = Date.now();
	let lastMarkAt = startedAt;
	let lastMarkUpdated = 0;
	let cursor = startCursor;
	let lastSeenId = Number.isFinite(startCursor) && startCursor < Number.POSITIVE_INFINITY ? startCursor : null;
	let scanned = 0;
	let skipped = 0;
	let updated = 0;
	let failed = 0;

	function logPace(lastId) {
		const now = Date.now();
		const elapsed = now - startedAt;
		const windowMs = now - lastMarkAt;
		const windowUpdated = updated - lastMarkUpdated;
		const overall = formatPerMin(updated, elapsed);
		const recent = formatPerMin(windowUpdated, windowMs);
		const left = remainingHint != null ? Math.max(0, remainingHint - scanned) : null;
		let eta = "";
		if (left != null && elapsed >= 1000 && updated > 0) {
			eta = ` eta≈${formatDuration(left / (updated / elapsed))}`;
		}
		console.log(
			`  … ${formatDuration(elapsed)} updated=${updated} ${overall} (last ${windowUpdated} ${recent}) scanned=${scanned} skipped=${skipped} failed=${failed} id=${lastId}${eta}`
		);
		lastMarkAt = now;
		lastMarkUpdated = updated;
	}

	while (scanned < maxRows) {
		const take = Math.min(pageSize, maxRows - scanned);
		let query = supabase
			.from(CREATED_TABLE)
			.select("id, filename, file_path, width, height, status, unavailable_at, meta")
			.not("filename", "like", "group/%")
			.order("id", { ascending: false })
			.limit(take);
		if (Number.isFinite(cursor) && cursor < Number.POSITIVE_INFINITY) {
			query = query.lt("id", cursor);
		}
		const { data, error } = await query;
		if (error) throw error;
		const rows = data ?? [];
		if (!rows.length) break;

		for (const row of rows) {
			cursor = Number(row.id);
			if (Number.isFinite(cursor) && cursor > 0) lastSeenId = cursor;
			const rowFilename = typeof row.filename === "string" ? row.filename.trim() : "";
			if (!rowFilename || rowFilename.includes("..")) continue;
			if (row.unavailable_at) continue;
			const status = typeof row.status === "string" ? row.status.trim() : "completed";
			if (status && status !== "completed") continue;

			scanned += 1;
			if (rowFilename.startsWith("group/")) {
				skipped += 1;
				continue;
			}
			const filename = resolveCreatedImageStorageFilename(row) || rowFilename;
			if (!filename || filename.startsWith("group/") || filename.includes("..")) {
				skipped += 1;
				continue;
			}

			try {
				const w = Number(row.width) || 0;
				const h = Number(row.height) || 0;
				const wantsFit = w > 0 && h > 0 ? shouldGenerateFitThumbnail(w, h) : true;
				let squareNeeds = true;
				let fitNeeds = wantsFit;

				if (skipExisting) {
					squareNeeds = true;
					fitNeeds = false;
					try {
						const existingSquare = await download(supabase, THUMB_BUCKET, filename);
						squareNeeds = !(await isWebpBuffer(existingSquare));
					} catch {
						squareNeeds = true;
					}
					if (wantsFit) {
						try {
							const existingFit = await download(
								supabase,
								THUMB_BUCKET,
								fitThumbnailStorageKey(filename)
							);
							fitNeeds = !(await isWebpBuffer(existingFit));
						} catch {
							fitNeeds = true;
						}
					}
					if (!squareNeeds && !fitNeeds) {
						skipped += 1;
						continue;
					}
				}

				const source = await download(supabase, CREATED_BUCKET, filename);

				if (squareNeeds) {
					const square = await buildSquareThumbnailBuffer(source);
					if (dryRun) {
						console.log(
							`  [dry-run] ${row.id} square ${formatBytes(source.length)} → ${formatBytes(square.length)}`
						);
					} else {
						const { error: upErr } = await supabase.storage.from(THUMB_BUCKET).upload(filename, square, {
							contentType: "image/webp",
							upsert: true
						});
						if (upErr) throw upErr;
					}
				}

				if (fitNeeds) {
					const dims =
						w > 0 && h > 0
							? { width: w, height: h }
							: await sharp(source, { failOn: "none" }).metadata();
					const dw = Number(dims.width) || 0;
					const dh = Number(dims.height) || 0;
					if (dw > 0 && dh > 0 && shouldGenerateFitThumbnail(dw, dh)) {
						const fit = await buildFitThumbnailBuffer(source);
						const fitKey = fitThumbnailStorageKey(filename);
						if (dryRun) {
							console.log(`  [dry-run] ${row.id} fit → ${formatBytes(fit.length)} ${fitKey}`);
						} else {
							const { error: fitErr } = await supabase.storage
								.from(THUMB_BUCKET)
								.upload(fitKey, fit, { contentType: "image/webp", upsert: true });
							if (fitErr) throw fitErr;
						}
					}
				}

				updated += 1;
				if (!dryRun && updated % 50 === 0) {
					logPace(row.id);
				}
				if (respawnMs > 0 && Date.now() - startedAt >= respawnMs && lastSeenId) {
					console.log(
						`respawn after ${formatDuration(Date.now() - startedAt)} at id=${lastSeenId}`
					);
					writeResumeCursor(lastSeenId);
					process.exit(RESPAWN_EXIT);
				}
			} catch (err) {
				failed += 1;
				console.error(`  creation ${row.id}: ${formatErr(err)}`);
			}
		}

		if (rows.length < take) break;
	}

	const elapsed = Date.now() - startedAt;
	console.log(
		`done ${formatDuration(elapsed)} scanned=${scanned} updated=${updated} ${formatPerMin(updated, elapsed)} skipped=${skipped} failed=${failed}`
	);
	if (failed > 0) process.exitCode = 1;
}

async function supervise() {
	let cursor = Number.isFinite(beforeId) && beforeId > 0 ? beforeId : null;
	let generation = 1;
	while (true) {
		if (generation > 1) {
			console.log(`[supervisor] worker ${generation} before-id=${cursor}`);
		}
		const code = await runWorker(cursor);
		if (code === RESPAWN_EXIT) {
			cursor = readResumeCursor() ?? cursor;
			generation += 1;
			continue;
		}
		process.exit(code);
	}
}

if (!isWorker && respawnMs > 0) {
	supervise().catch((err) => {
		console.error(err);
		process.exit(1);
	});
} else {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
