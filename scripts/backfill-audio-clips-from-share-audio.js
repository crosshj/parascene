#!/usr/bin/env node
/**
 * Backfill audio clip library from historical data.
 *
 * Phase 1 (clips): prsn_audio_clips rows from prsn_created_images.meta.share_audio
 * Phase 2 (usage): prsn_audio_clip_usages + counters from completed A2V outputs
 *
 * Usage:
 *   node scripts/backfill-audio-clips-from-share-audio.js [--dry-run] [--limit=N]
 *   node scripts/backfill-audio-clips-from-share-audio.js --clips-only
 *   node scripts/backfill-audio-clips-from-share-audio.js --usage-only
 */
import { openDb } from "../db/index.js";
import { loadEnv } from "./repo-root.cjs";
import {
	buildAudioClipCreationSnapshot,
	buildClipOwnersMeta,
	resolveClipIdFromOutputMeta
} from "../api_routes/utils/audioClips.js";

loadEnv();

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const clipsOnly = argv.includes("--clips-only");
const usageOnly = argv.includes("--usage-only");
const limitArg = argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : null;

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

function mergeMeta(existing, patch) {
	const base = existing && typeof existing === "object" ? existing : {};
	return { ...base, ...(patch && typeof patch === "object" ? patch : {}) };
}

function usageTimestampFromMeta(meta, createdAt) {
	const completed = typeof meta?.completed_at === "string" ? meta.completed_at.trim() : "";
	if (completed) return completed;
	return typeof createdAt === "string" && createdAt ? createdAt : new Date().toISOString();
}

async function backfillClips(queries, { dryRun: isDryRun, limit: maxRows }) {
	const listFn = queries.selectCreatedImagesWithShareAudioForBackfill?.page;
	const insertFn = queries.insertAudioClip?.run;
	const getByKey = queries.selectAudioClipByStorageKey?.get;
	if (typeof listFn !== "function") {
		throw new Error("selectCreatedImagesWithShareAudioForBackfill.page is not available");
	}
	if (!isDryRun && typeof insertFn !== "function") {
		throw new Error("insertAudioClip.run is not available");
	}

	let offset = 0;
	const pageSize = 100;
	let scanned = 0;
	let inserted = 0;
	let skippedExisting = 0;
	let skippedInvalid = 0;

	console.log(isDryRun ? "[dry-run] Phase 1: clip rows from meta.share_audio" : "Phase 1: clip rows from meta.share_audio");

	while (true) {
		const batchLimit = maxRows != null ? Math.min(pageSize, Math.max(0, maxRows - scanned)) : pageSize;
		if (batchLimit <= 0) break;
		const { items } = await listFn({ limit: batchLimit, offset });
		const rows = Array.isArray(items) ? items : [];
		if (!rows.length) break;

		for (const row of rows) {
			scanned += 1;
			const meta = parseMeta(row.meta);
			const shareAudio = meta?.share_audio && typeof meta.share_audio === "object" ? meta.share_audio : null;
			const storageKey = typeof shareAudio?.key === "string" ? shareAudio.key.trim() : "";
			if (!storageKey) {
				skippedInvalid += 1;
				continue;
			}
			const existing = typeof getByKey === "function" ? await getByKey(storageKey) : null;
			if (existing) {
				skippedExisting += 1;
				continue;
			}
			const ownerId = Number(row.user_id);
			if (!Number.isFinite(ownerId) || ownerId <= 0) {
				skippedInvalid += 1;
				continue;
			}
			const titleBase =
				typeof row.title === "string" && row.title.trim()
					? row.title.trim()
					: `Creation #${row.id}`;
			const clipRow = {
				title: `Audio from ${titleBase}`,
				description: null,
				storage_key: storageKey,
				content_type:
					typeof shareAudio.content_type === "string" && shareAudio.content_type
						? shareAudio.content_type
						: "audio/webm",
				byte_size: Number(shareAudio.byte_size) > 0 ? Number(shareAudio.byte_size) : 0,
				duration_sec: null,
				source_type: "video_extract",
				source_created_image_id: row.id,
				meta: buildClipOwnersMeta({ creatorUserId: ownerId, sourceUserId: ownerId })
			};
			if (isDryRun) {
				console.log(`  [dry-run] would insert clip for creation ${row.id} key=${storageKey}`);
				inserted += 1;
				continue;
			}
			try {
				await insertFn(clipRow);
				inserted += 1;
			} catch (err) {
				const msg = String(err?.message || "");
				if (err?.code === "23505" || msg.includes("duplicate key")) {
					skippedExisting += 1;
				} else {
					console.error(`  Failed creation ${row.id}:`, msg || err);
				}
			}
		}

		offset += rows.length;
		if (rows.length < batchLimit) break;
		if (maxRows != null && scanned >= maxRows) break;
	}

	console.log(
		`Phase 1 done. scanned=${scanned} inserted=${inserted} skipped_existing=${skippedExisting} skipped_invalid=${skippedInvalid}`
	);
}

async function backfillUsages(queries, { dryRun: isDryRun, limit: maxRows }) {
	const listFn = queries.selectCompletedCreationsForAudioClipUsageBackfill?.page;
	const insertUsageFn = queries.insertAudioClipUsage?.run;
	const getUsageFn = queries.selectAudioClipUsageByCreatedImageId?.get;
	const getClipFn = queries.selectAudioClipById?.get;
	const updateMetaFn = queries.updateCreatedImageMetaAnyUser?.run;
	const reconcileAllFn = queries.reconcileAllAudioClipUsageCounters?.run;
	if (typeof listFn !== "function") {
		throw new Error("selectCompletedCreationsForAudioClipUsageBackfill.page is not available");
	}
	if (!isDryRun && typeof insertUsageFn !== "function") {
		throw new Error("insertAudioClipUsage.run is not available");
	}

	let offset = 0;
	const pageSize = 100;
	let scanned = 0;
	let usagesInserted = 0;
	let usagesSkipped = 0;
	let unresolved = 0;
	let snapshotsPatched = 0;
	const touchedClipIds = new Set();

	console.log(
		isDryRun
			? "[dry-run] Phase 2: usage rows from completed outputs (meta.args / meta.audio_clip)"
			: "Phase 2: usage rows from completed outputs (meta.args / meta.audio_clip)"
	);

	while (true) {
		const batchLimit = maxRows != null ? Math.min(pageSize, Math.max(0, maxRows - scanned)) : pageSize;
		if (batchLimit <= 0) break;
		const { items } = await listFn({ limit: batchLimit, offset });
		const rows = Array.isArray(items) ? items : [];
		if (!rows.length) break;

		for (const row of rows) {
			scanned += 1;
			const meta = parseMeta(row.meta);
			const clipId = await resolveClipIdFromOutputMeta(queries, meta);
			if (!Number.isFinite(clipId) || clipId <= 0) {
				unresolved += 1;
				continue;
			}

			const existingUsage =
				typeof getUsageFn === "function" ? await getUsageFn(row.id) : null;
			if (existingUsage) {
				usagesSkipped += 1;
				touchedClipIds.add(clipId);
				continue;
			}

			const args = meta?.args && typeof meta.args === "object" ? meta.args : {};
			const usedAt = usageTimestampFromMeta(meta, row.created_at);
			const audioUrl =
				typeof args.audio_url === "string"
					? args.audio_url
					: typeof args.input_audio_urls === "string"
						? args.input_audio_urls
						: null;
			const usageMeta = {
				audio_url: audioUrl,
				backfill: true
			};

			if (isDryRun) {
				console.log(
					`  [dry-run] would insert usage clip=${clipId} output=${row.id} used_at=${usedAt}`
				);
				usagesInserted += 1;
				touchedClipIds.add(clipId);
			} else {
				try {
					await insertUsageFn({
						audioClipId: clipId,
						createdImageId: row.id,
						meta: usageMeta,
						usedAt
					});
					usagesInserted += 1;
					touchedClipIds.add(clipId);
				} catch (err) {
					const msg = String(err?.message || "");
					if (err?.code === "23505" || msg.includes("duplicate key")) {
						usagesSkipped += 1;
					} else {
						console.error(`  Failed usage output ${row.id} clip ${clipId}:`, msg || err);
						continue;
					}
				}
			}

			const hasSnapshot = meta?.audio_clip && typeof meta.audio_clip === "object" && Number(meta.audio_clip.id) > 0;
			if (!hasSnapshot && typeof getClipFn === "function" && typeof updateMetaFn === "function") {
				const clip = await getClipFn(clipId);
				const snapshot = buildAudioClipCreationSnapshot(clip);
				if (snapshot) {
					if (isDryRun) {
						console.log(`  [dry-run] would patch meta.audio_clip on output ${row.id}`);
						snapshotsPatched += 1;
					} else {
						const nextMeta = mergeMeta(meta, { audio_clip: snapshot });
						await updateMetaFn(row.id, nextMeta);
						snapshotsPatched += 1;
					}
				}
			}
		}

		offset += rows.length;
		if (rows.length < batchLimit) break;
		if (maxRows != null && scanned >= maxRows) break;
	}

	if (!isDryRun && typeof reconcileAllFn === "function") {
		console.log("Reconciling usage_count / last_used_at on all clips…");
		await reconcileAllFn();
	} else if (isDryRun && touchedClipIds.size > 0) {
		console.log(`  [dry-run] would reconcile counters on ${touchedClipIds.size} clip(s)`);
	}

	console.log(
		`Phase 2 done. scanned=${scanned} usages_inserted=${usagesInserted} usages_skipped=${usagesSkipped} unresolved=${unresolved} snapshots_patched=${snapshotsPatched}`
	);
}

async function main() {
	const runClips = !usageOnly;
	const runUsage = !clipsOnly;

	if (!runClips && !runUsage) {
		console.error("Nothing to do. Omit --clips-only and --usage-only to run both phases.");
		process.exit(1);
	}

	const { queries } = await openDb();

	if (runClips) {
		await backfillClips(queries, { dryRun, limit });
	}
	if (runUsage) {
		await backfillUsages(queries, { dryRun, limit });
	}

	if (dryRun) {
		console.log("[dry-run] No database writes were made.");
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
