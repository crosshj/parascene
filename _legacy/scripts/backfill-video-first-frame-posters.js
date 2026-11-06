#!/usr/bin/env node
/**
 * Replace t2v placeholders and r2v character-sheet posters with the video's
 * first frame. Local ffmpeg — not used on Vercel.
 *
 * Usage:
 *   node scripts/backfill-video-first-frame-posters.js --dry-run
 *   node scripts/backfill-video-first-frame-posters.js
 *   node scripts/backfill-video-first-frame-posters.js --limit 25
 *   node scripts/backfill-video-first-frame-posters.js --before-id 12000
 *   node scripts/backfill-video-first-frame-posters.js --id 24130
 *   node scripts/backfill-video-first-frame-posters.js --r2v-only
 *   node scripts/backfill-video-first-frame-posters.js --force
 *
 * Requires: ffmpeg on PATH, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { openDb } from "../db/index.js";
import { loadEnv } from "./repo-root.cjs";
import { bumpFeedVersionCounter } from "../api_routes/feed/feedVersion.js";
import { invalidateFeedBetaCatalogSnapshot } from "../api_routes/feedBeta/catalogSnapshot.js";
import {
	isReferenceToVideoCreation,
	shouldAutoSetVideoPosterFromFirstFrame,
} from "../public/shared/aspectRatio.js";

loadEnv();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const r2vOnly = args.includes("--r2v-only");
const limitArg = readFlagValue(args, "--limit");
const maxRows = limitArg != null ? Number(limitArg) : Infinity;
const beforeIdArg = readFlagValue(args, "--before-id");
const startBeforeId = beforeIdArg != null ? Number(beforeIdArg) : null;
const idArg = readFlagValue(args, "--id");
const onlyId = idArg != null ? Number(idArg) : null;

function readFlagValue(list, flag) {
	const idx = list.indexOf(flag);
	if (idx < 0) return null;
	const value = list[idx + 1];
	if (!value || value.startsWith("--")) return null;
	return value;
}

function parseMeta(raw) {
	if (raw == null) return {};
	if (typeof raw === "object" && !Array.isArray(raw)) return raw;
	if (typeof raw !== "string" || !raw.trim()) return {};
	try {
		const o = JSON.parse(raw);
		return o && typeof o === "object" && !Array.isArray(o) ? o : {};
	} catch {
		return {};
	}
}

function videoFilenameFromMeta(meta) {
	const videoMeta = meta?.video;
	if (!videoMeta || typeof videoMeta !== "object") return null;
	if (typeof videoMeta.filename === "string" && videoMeta.filename.startsWith("video/")) {
		return videoMeta.filename;
	}
	const fp = typeof videoMeta.file_path === "string" ? videoMeta.file_path.trim() : "";
	if (fp.startsWith("/api/videos/created/")) {
		return fp.slice("/api/videos/created/".length);
	}
	return null;
}

function asPosterCreation(image, meta) {
	const videoUrl =
		typeof meta?.video?.file_path === "string" ? meta.video.file_path : null;
	return {
		id: image.id,
		status: image.status || "completed",
		width: image.width,
		height: image.height,
		meta,
		media_type: typeof meta?.media_type === "string" ? meta.media_type : "video",
		video_url: videoUrl,
		source_image_url:
			typeof meta?.source_image_url === "string" ? meta.source_image_url : null,
	};
}

function needsPosterBackfill(image, meta) {
	const creation = asPosterCreation(image, meta);
	if (r2vOnly && !isReferenceToVideoCreation(creation)) return false;
	if (force) {
		if (String(creation.status || "").toLowerCase() !== "completed") return false;
		if (!videoFilenameFromMeta(meta)) return false;
		if (r2vOnly) return true;
		return shouldAutoSetVideoPosterFromFirstFrame({
			...creation,
			meta: { ...meta, video_placeholder_manual: false },
		});
	}
	return shouldAutoSetVideoPosterFromFirstFrame(creation);
}

function runFfmpeg(ffmpegArgs) {
	return new Promise((resolve, reject) => {
		const child = spawn("ffmpeg", ffmpegArgs, { stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
			if (stderr.length > 4000) stderr = stderr.slice(-4000);
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("ffmpeg timed out"));
		}, 90_000);
		child.on("error", (err) => {
			clearTimeout(timer);
			if (err?.code === "ENOENT") {
				reject(new Error("ffmpeg not found on PATH"));
			} else {
				reject(err);
			}
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(new Error(stderr.trim() || `ffmpeg exited ${code}`));
		});
	});
}

async function assertFfmpeg() {
	await new Promise((resolve, reject) => {
		const child = spawn("ffmpeg", ["-version"], { stdio: ["ignore", "ignore", "ignore"] });
		child.on("error", (err) => {
			if (err?.code === "ENOENT") reject(new Error("ffmpeg not found on PATH. Install ffmpeg and retry."));
			else reject(err);
		});
		child.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error("ffmpeg -version failed"));
		});
	});
}

async function extractFirstFramePng(videoBuffer) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prsn-video-poster-"));
	const inPath = path.join(dir, "in.mp4");
	const outPath = path.join(dir, "frame.png");
	try {
		await fs.writeFile(inPath, videoBuffer);
		await runFfmpeg([
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			inPath,
			"-frames:v",
			"1",
			"-an",
			outPath,
		]);
		const raw = await fs.readFile(outPath);
		return await sharp(raw, { failOn: "none" }).png().toBuffer();
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

async function applyPoster({ queries, storage, image, meta, pngBuffer }) {
	const sharpMeta = await sharp(pngBuffer).metadata();
	const width = Number(sharpMeta.width);
	const height = Number(sharpMeta.height);
	if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
		throw new Error("Could not read frame dimensions");
	}
	const timestamp = Date.now();
	const random = randomBytes(4).toString("hex").slice(0, 7);
	const filename = `${image.user_id}_${image.id}_${timestamp}_${random}.png`;
	const imageUrl = await storage.uploadImage(pngBuffer, filename);
	const nextMeta = { ...meta, video_placeholder_manual: true };
	const updateResult = await queries.updateCreatedImageJobCompleted.run(image.id, image.user_id, {
		filename,
		file_path: imageUrl,
		width,
		height,
		color: image.color ?? null,
		meta: nextMeta,
	});
	if (!updateResult || updateResult.changes === 0) {
		throw new Error("Failed to update creation poster");
	}
	return { url: imageUrl, width, height };
}

async function backfillOne({ queries, storage, image, dryRun }) {
	const meta = parseMeta(image.meta);
	if (!needsPosterBackfill(image, meta)) return "skip";
	const videoKey = videoFilenameFromMeta(meta);
	if (!videoKey) return "skip";
	const label = `${image.id}${image.title ? ` ${image.title}` : ""}`;
	if (dryRun) {
		console.log(`would update ${label}`);
		return "needed";
	}
	console.log(`update ${label}`);
	const videoBuffer = await storage.getVideoBuffer(videoKey);
	const pngBuffer = await extractFirstFramePng(videoBuffer);
	await applyPoster({ queries, storage, image, meta, pngBuffer });
	return "updated";
}

async function main() {
	const { queries, storage } = await openDb();
	if (!dryRun) {
		if (typeof storage?.getVideoBuffer !== "function") {
			throw new Error("storage.getVideoBuffer is not available");
		}
		if (typeof storage?.uploadImage !== "function") {
			throw new Error("storage.uploadImage is not available");
		}
		if (typeof queries.updateCreatedImageJobCompleted?.run !== "function") {
			throw new Error("updateCreatedImageJobCompleted is not available");
		}
		await assertFfmpeg();
	}

	let scanned = 0;
	let needed = 0;
	let updated = 0;
	let failed = 0;
	let skipped = 0;

	if (Number.isFinite(onlyId) && onlyId > 0) {
		const image = await queries.selectCreatedImageByIdAnyUser?.get(onlyId);
		if (!image) {
			console.error(`Creation ${onlyId} not found`);
			process.exit(1);
		}
		scanned = 1;
		try {
			const result = await backfillOne({ queries, storage, image, dryRun });
			if (result === "updated") updated = 1;
			else if (result === "needed") needed = 1;
			else skipped = 1;
		} catch (err) {
			failed = 1;
			console.error(`failed ${image.id}:`, err?.message || err);
		}
		if (updated > 0 && !dryRun) {
			await bumpFeedVersionCounter(queries);
			void invalidateFeedBetaCatalogSnapshot().catch(() => {});
		}
		console.log(JSON.stringify({ dryRun, force, r2vOnly, scanned, needed: needed + updated, updated, skipped, failed }, null, 2));
		return;
	}

	if (typeof queries.selectCompletedVideoCreationsForPosterBackfill?.page !== "function") {
		throw new Error("selectCompletedVideoCreationsForPosterBackfill is not available");
	}

	let beforeId = Number.isFinite(startBeforeId) && startBeforeId > 0 ? startBeforeId : null;

	while (scanned < maxRows) {
		const pageLimit = Math.min(50, maxRows - scanned);
		const { items } = await queries.selectCompletedVideoCreationsForPosterBackfill.page({
			limit: pageLimit,
			beforeId,
		});
		if (!items.length) break;

		for (const image of items) {
			scanned += 1;
			beforeId = image.id;
			try {
				const result = await backfillOne({ queries, storage, image, dryRun });
				if (result === "updated") {
					needed += 1;
					updated += 1;
				} else if (result === "needed") {
					needed += 1;
				} else {
					skipped += 1;
				}
			} catch (err) {
				needed += 1;
				failed += 1;
				console.error(`failed ${image.id}:`, err?.message || err);
			}
			if (scanned >= maxRows) break;
		}

		if (items.length < pageLimit) break;
	}

	if (updated > 0 && !dryRun) {
		await bumpFeedVersionCounter(queries);
		void invalidateFeedBetaCatalogSnapshot().catch(() => {});
	}

	console.log(
		JSON.stringify({ dryRun, force, r2vOnly, scanned, needed, updated, skipped, failed, beforeId }, null, 2)
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
