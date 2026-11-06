#!/usr/bin/env node
/**
 * Give existing audio creations a procedural cover when they still have a
 * placeholder / waveform still.
 *
 * Usage:
 *   node scripts/backfill-audio-covers.js --dry-run
 *   node scripts/backfill-audio-covers.js
 *   node scripts/backfill-audio-covers.js --limit 25
 *   node scripts/backfill-audio-covers.js --before-id 12000
 *   node scripts/backfill-audio-covers.js --restore-import-originals
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { openDb } from "../db/index.js";
import { loadEnv } from "./repo-root.cjs";
import { isPlaceholderAudioCover } from "../api_routes/utils/audioCoverPublic.js";
import {
	applyAudioCoverBuffer,
	audioCreationNeedsCoverBackfill,
	buildProceduralCoverForCreation,
	inferAudioCoverSource,
	parseCreationMeta,
} from "../api_routes/utils/audioCoverApply.js";

loadEnv();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const restoreImportOriginals = args.includes("--restore-import-originals");
const limitArg = readFlagValue(args, "--limit");
const maxRows = limitArg != null ? Number(limitArg) : Infinity;
const beforeIdArg = readFlagValue(args, "--before-id");
const startBeforeId = beforeIdArg != null ? Number(beforeIdArg) : null;

function readFlagValue(list, flag) {
	const idx = list.indexOf(flag);
	if (idx < 0) return null;
	const value = list[idx + 1];
	if (!value || value.startsWith("--")) return null;
	return value;
}

function parseMeta(raw) {
	return parseCreationMeta(raw) || {};
}

function importProvider(meta) {
	const provider = meta?.import && typeof meta.import === "object" ? meta.import.provider : "";
	return typeof provider === "string" ? provider.trim().toLowerCase() : "";
}

function factoryImportCoverSource(meta) {
	const provider = importProvider(meta);
	if (provider === "suno" || provider === "youtube") return "import";
	if (provider === "file") return "embedded";
	return inferAudioCoverSource({ ...meta, cover_source: "" }) || "import";
}

function importOriginalToRestore(image, meta) {
	const provider = importProvider(meta);
	if (provider !== "suno" && provider !== "file" && provider !== "youtube") return null;
	if (meta?.cover_source !== "procedural") return null;
	const original = meta.cover_original && typeof meta.cover_original === "object" ? meta.cover_original : null;
	const origPath = typeof original?.file_path === "string" ? original.file_path.trim() : "";
	if (!origPath || isPlaceholderAudioCover(origPath)) return null;
	return original;
}

async function restoreImportOriginalsFromSnapshots({ queries, dryRun, maxRows, startBeforeId }) {
	if (typeof queries.updateCreatedImageJobCompleted?.run !== "function") {
		throw new Error("updateCreatedImageJobCompleted is not available");
	}

	let beforeId = Number.isFinite(startBeforeId) && startBeforeId > 0 ? startBeforeId : null;
	let scanned = 0;
	let needed = 0;
	let updated = 0;
	let failed = 0;

	while (scanned < maxRows) {
		const pageLimit = Math.min(50, maxRows - scanned);
		const { items } = await queries.selectCompletedAudioCreationsForCoverBackfill.page({
			limit: pageLimit,
			beforeId,
		});
		if (!items.length) break;

		for (const image of items) {
			scanned += 1;
			beforeId = image.id;
			const meta = parseMeta(image.meta);
			const original = importOriginalToRestore(image, meta);
			if (!original) continue;
			needed += 1;
			const coverSource = factoryImportCoverSource(meta);
			console.log(`${dryRun ? "would restore" : "restore"} ${image.id} ${image.title || ""}`.trim());
			if (dryRun) continue;
			try {
				const nextMeta = { ...meta, cover_source: coverSource };
				delete nextMeta.cover_original;
				delete nextMeta.cover_placeholder;
				const updateResult = await queries.updateCreatedImageJobCompleted.run(image.id, image.user_id, {
					filename: typeof original.filename === "string" ? original.filename : image.filename,
					file_path: original.file_path,
					width: Number(original.width) > 0 ? Number(original.width) : image.width,
					height: Number(original.height) > 0 ? Number(original.height) : image.height,
					color: image.color ?? null,
					meta: nextMeta,
				});
				if (!updateResult || updateResult.changes === 0) {
					throw new Error("Failed to restore cover");
				}
				updated += 1;
			} catch (err) {
				failed += 1;
				console.error(`failed ${image.id}:`, err?.message || err);
			}
			if (scanned >= maxRows) break;
		}

		if (items.length < pageLimit) break;
	}

	console.log(
		JSON.stringify({ restoreImportOriginals: true, dryRun, scanned, needed, updated, failed }, null, 2)
	);
}

async function main() {
	const { queries, storage } = await openDb();
	if (typeof queries.selectCompletedAudioCreationsForCoverBackfill?.page !== "function") {
		throw new Error("selectCompletedAudioCreationsForCoverBackfill is not available");
	}
	if (restoreImportOriginals) {
		await restoreImportOriginalsFromSnapshots({
			queries,
			dryRun,
			maxRows,
			startBeforeId,
		});
		return;
	}
	if (!dryRun && typeof storage?.uploadImage !== "function") {
		throw new Error("storage.uploadImage is not available");
	}

	let beforeId = Number.isFinite(startBeforeId) && startBeforeId > 0 ? startBeforeId : null;
	let scanned = 0;
	let needed = 0;
	let updated = 0;
	let failed = 0;

	while (scanned < maxRows) {
		const pageLimit = Math.min(50, maxRows - scanned);
		const { items } = await queries.selectCompletedAudioCreationsForCoverBackfill.page({
			limit: pageLimit,
			beforeId,
		});
		if (!items.length) break;

		for (const image of items) {
			scanned += 1;
			beforeId = image.id;
			const meta = parseMeta(image.meta);
			if (!audioCreationNeedsCoverBackfill(image, meta)) continue;
			needed += 1;
			console.log(`${dryRun ? "would update" : "update"} ${image.id} ${image.title || ""}`.trim());
			if (dryRun) continue;
			try {
				const built = await buildProceduralCoverForCreation(image, meta);
				await applyAudioCoverBuffer({
					queries,
					storage,
					image,
					buffer: built.buffer,
					coverSource: "procedural",
				});
				updated += 1;
			} catch (err) {
				failed += 1;
				console.error(`failed ${image.id}:`, err?.message || err);
			}
			if (scanned >= maxRows) break;
		}

		if (items.length < pageLimit) break;
	}

	console.log(
		JSON.stringify({ dryRun, scanned, needed, updated, failed }, null, 2)
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
