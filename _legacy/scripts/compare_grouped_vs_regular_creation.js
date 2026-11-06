import "dotenv/config";
import { openDb } from "../db/index.js";
import { getThumbnailUrl } from "../api_routes/utils/url.js";

const GROUPED_ID = 7565;
const REGULAR_ID = 7559;

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

function pick(obj, keys) {
	const out = {};
	for (const key of keys) out[key] = obj?.[key];
	return out;
}

function flatten(value, prefix = "", out = {}) {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		out[prefix] = value;
		return out;
	}
	const keys = Object.keys(value).sort();
	for (const key of keys) {
		const path = prefix ? `${prefix}.${key}` : key;
		const next = value[key];
		if (next != null && typeof next === "object" && !Array.isArray(next)) {
			flatten(next, path, out);
		} else {
			out[path] = next;
		}
	}
	return out;
}

function diffObjects(a, b, labelA, labelB) {
	const flatA = flatten(a);
	const flatB = flatten(b);
	const allKeys = [...new Set([...Object.keys(flatA), ...Object.keys(flatB)])].sort();
	const diffs = [];
	for (const key of allKeys) {
		const va = flatA[key];
		const vb = flatB[key];
		if (JSON.stringify(va) !== JSON.stringify(vb)) {
			diffs.push({ key, [labelA]: va, [labelB]: vb });
		}
	}
	return diffs;
}

function deriveUiFields(row, storage) {
	const filename = typeof row?.filename === "string" ? row.filename : "";
	const filePath = typeof row?.file_path === "string" ? row.file_path : "";
	const urlFromFilename = filename ? storage?.getImageUrl?.(filename) : null;
	const resolvedImageUrl = filePath || urlFromFilename || null;
	const thumbnailUrl = resolvedImageUrl ? getThumbnailUrl(resolvedImageUrl) : null;
	return {
		file_path: filePath || null,
		filename: filename || null,
		resolved_image_url: resolvedImageUrl,
		thumbnail_url: thumbnailUrl,
		file_path_has_thumbnail_variant:
			typeof filePath === "string" && /(?:\?|&)variant=thumbnail(?:&|$)/.test(filePath),
		file_path_route_kind:
			filePath.startsWith("/api/images/created/")
				? "api-created-route"
				: filePath.startsWith("/images/created/")
					? "static-created-route"
					: filePath
						? "other"
						: "empty"
	};
}

async function loadSnapshot(id, ctx) {
	const { queries, storage } = ctx;
	const created = await queries.selectCreatedImageByIdAnyUser.get(id);
	const feedItem = typeof queries.selectFeedItemByCreatedImageId?.get === "function"
		? await queries.selectFeedItemByCreatedImageId.get(id)
		: null;
	const projectedRows = typeof queries.selectFeedItemsByCreationIds?.all === "function"
		? await queries.selectFeedItemsByCreationIds.all([id])
		: [];
	const projected = Array.isArray(projectedRows) ? (projectedRows[0] || null) : null;

	const meta = parseMeta(created?.meta);
	const group = meta?.group && typeof meta.group === "object" ? meta.group : null;
	const sourceCreations = Array.isArray(group?.source_creations) ? group.source_creations : [];

	return {
		id,
		created: pick(created, [
			"id",
			"user_id",
			"filename",
			"file_path",
			"width",
			"height",
			"color",
			"status",
			"created_at",
			"published",
			"published_at",
			"title",
			"description",
			"unavailable_at"
		]),
		derived_ui: deriveUiFields(created, storage),
		feed_item_row: feedItem
			? pick(feedItem, ["id", "created_image_id", "title", "summary", "author", "tags", "created_at"])
			: null,
		feed_projection: projected
			? pick(projected, ["id", "created_image_id", "title", "summary", "url", "media_type", "video_url", "nsfw"])
			: null,
		meta_summary: {
			media_type: meta?.media_type ?? null,
			nsfw: meta?.nsfw ?? null,
			group_kind: group?.kind ?? null,
			group_cover_source_id: group?.cover_source_id ?? null,
			group_source_count: sourceCreations.length,
			group_first_source: sourceCreations[0]
				? {
					id: sourceCreations[0]?.id ?? null,
					filename: sourceCreations[0]?.filename ?? null,
					file_path: sourceCreations[0]?.file_path ?? null
				}
				: null
		}
	};
}

async function main() {
	const ctx = await openDb({ quiet: true });
	const grouped = await loadSnapshot(GROUPED_ID, ctx);
	const regular = await loadSnapshot(REGULAR_ID, ctx);
	const groupedCoverId = Number(grouped?.meta_summary?.group_cover_source_id);
	const groupedCoverSource = Number.isFinite(groupedCoverId) && groupedCoverId > 0
		? await loadSnapshot(groupedCoverId, ctx)
		: null;

	const diffs = diffObjects(grouped, regular, `id_${GROUPED_ID}`, `id_${REGULAR_ID}`);
	const likelyUiDiffs = diffs.filter((d) =>
		d.key.startsWith("created.file_path") ||
		d.key.startsWith("created.filename") ||
		d.key.startsWith("derived_ui.") ||
		d.key.startsWith("feed_item_row.") ||
		d.key.startsWith("feed_projection.") ||
		d.key.startsWith("meta_summary.")
	);

	console.log(`Compared grouped=${GROUPED_ID} vs regular=${REGULAR_ID}`);
	console.log("");
	console.log("== Grouped snapshot ==");
	console.log(JSON.stringify(grouped, null, 2));
	console.log("");
	console.log("== Regular snapshot ==");
	console.log(JSON.stringify(regular, null, 2));
	console.log("");
	if (groupedCoverSource) {
		const groupedFilePath = grouped?.created?.file_path ?? null;
		const groupedFilenameUrl = grouped?.created?.filename ? ctx?.storage?.getImageUrl?.(grouped.created.filename) : null;
		const coverFilePath = groupedCoverSource?.created?.file_path ?? null;
		console.log(`== Grouped cover source snapshot (${groupedCoverId}) ==`);
		console.log(JSON.stringify(groupedCoverSource, null, 2));
		console.log("");
		console.log("== Grouped cover invariants ==");
		console.log(JSON.stringify({
			grouped_file_path: groupedFilePath,
			grouped_filename_url: groupedFilenameUrl,
			cover_source_file_path: coverFilePath,
			grouped_file_path_matches_cover_source: groupedFilePath === coverFilePath,
			grouped_file_path_matches_grouped_filename_url: groupedFilePath === groupedFilenameUrl
		}, null, 2));
		console.log("");
	}
	console.log(`== Likely UI-relevant differences (${likelyUiDiffs.length}) ==`);
	console.log(JSON.stringify(likelyUiDiffs, null, 2));
}

main().catch((err) => {
	console.error("compare_grouped_vs_regular_creation failed:", err);
	process.exitCode = 1;
});

