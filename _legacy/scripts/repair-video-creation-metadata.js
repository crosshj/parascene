#!/usr/bin/env node
/**
 * Repair stored width/height + poster for video creations where aspect_ratio
 * in meta.args does not match the square source-image poster (e.g. 1:1 → 9:16 i2v).
 *
 * Usage: node scripts/repair-video-creation-metadata.js <creation_id>
 */
import { openDb } from "../db/index.js";
import { loadEnv } from "./repo-root.cjs";
import { letterboxImageBuffer } from "../api_routes/utils/editedImageUpload.js";
import { dimensionsForAspectRatioLongEdge, parseAspectRatioString } from "../public/shared/aspectRatio.js";

loadEnv();

const creationId = Number(process.argv[2]);
if (!Number.isFinite(creationId) || creationId <= 0) {
	console.error("Usage: node scripts/repair-video-creation-metadata.js <creation_id>");
	process.exit(1);
}

function parseMeta(raw) {
	if (raw == null) return null;
	if (typeof raw === "object") return raw;
	if (typeof raw !== "string") return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

async function fetchImageBuffer(url) {
	const res = await fetch(url, { headers: { Accept: "image/*" } });
	if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

async function main() {
	const { queries, storage } = await openDb();
	const row = await queries.selectCreatedImageByIdAnyUser.get(creationId);
	if (!row) {
		console.error(`Creation ${creationId} not found`);
		process.exit(1);
	}

	const meta = parseMeta(row.meta) || {};
	const aspectRaw = meta?.args?.aspect_ratio;
	if (!parseAspectRatioString(aspectRaw)) {
		console.error("Creation has no meta.args.aspect_ratio — nothing to repair");
		process.exit(1);
	}

	const { width: targetW, height: targetH } = dimensionsForAspectRatioLongEdge(aspectRaw, 1024);
	if (Number(row.width) === targetW && Number(row.height) === targetH) {
		console.log(`Creation ${creationId} already has ${targetW}x${targetH}`);
	}

	const sourceUrl =
		(typeof meta.source_image_url === "string" && meta.source_image_url.trim()) ||
		(Array.isArray(meta?.args?.input_images) && typeof meta.args.input_images[0] === "string"
			? meta.args.input_images[0].trim()
			: "") ||
		(typeof meta?.args?.image_url === "string" ? meta.args.image_url.trim() : "");

	if (!sourceUrl) {
		console.error("No source image URL in meta");
		process.exit(1);
	}

	console.log(`Letterboxing source to ${aspectRaw} (${targetW}x${targetH})…`);
	const raw = await fetchImageBuffer(sourceUrl);
	const pngBuffer = await letterboxImageBuffer(raw, aspectRaw, 1024);

	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 9);
	const filename = `${row.user_id}_${creationId}_${timestamp}_${random}.png`;
	const imageUrl = await storage.uploadImage(pngBuffer, filename);

	await queries.updateCreatedImageJobCompleted.run(creationId, row.user_id, {
		filename,
		file_path: imageUrl,
		width: targetW,
		height: targetH,
		color: row.color || "#000000",
		meta,
	});

	console.log(`Repaired creation ${creationId}: ${targetW}x${targetH}, poster ${imageUrl}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
