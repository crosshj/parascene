import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_CSV = path.join(__dirname, '../fixtures/feedBeta/prod-published-catalog.csv');

/** Satisfies feedRowIsVideoThread; real URLs are not needed for ranking/pool tests. */
export const FIXTURE_VIDEO_PLACEHOLDER_URL = '/test/fixtures/feed-beta-video';

/**
 * Minimal RFC4180-style line parse (fixture columns only).
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
	const cells = [];
	let cur = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i += 1) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					cur += '"';
					i += 1;
				} else {
					inQuotes = false;
				}
			} else {
				cur += ch;
			}
			continue;
		}
		if (ch === '"') {
			inQuotes = true;
			continue;
		}
		if (ch === ',') {
			cells.push(cur);
			cur = '';
			continue;
		}
		cur += ch;
	}
	cells.push(cur);
	return cells;
}

/**
 * @param {Record<string, string>} record
 * @returns {object}
 */
function recordToFeedRow(record) {
	const createdImageId = Number(record.created_image_id);
	const userId = Number(record.user_id);
	const likes = Number(record.like_count ?? 0);
	const comments = Number(record.comment_count ?? 0);
	const mediaType = String(record.media_type ?? 'image').trim().toLowerCase();
	const isVideo = mediaType === 'video';
	const videoUrl = isVideo ? FIXTURE_VIDEO_PLACEHOLDER_URL : null;
	const meta = isVideo
		? { media_type: 'video', video: { file_path: videoUrl }, nsfw: record.nsfw === '1' }
		: { media_type: 'image', nsfw: record.nsfw === '1' };
	return {
		created_image_id: createdImageId,
		id: createdImageId,
		user_id: userId,
		created_at: record.created_at,
		like_count: Number.isFinite(likes) ? likes : 0,
		comment_count: Number.isFinite(comments) ? comments : 0,
		nsfw: record.nsfw === '1',
		meta,
		media_type: isVideo ? 'video' : 'image',
		video_url: videoUrl,
		author_created_at: record.author_created_at || null
	};
}

/**
 * Load prod-published-catalog.csv into feed-beta catalog row shape.
 * @param {{ csvPath?: string }} [opts]
 * @returns {{ rows: object[], manifestPath: string }}
 */
export function loadFeedBetaProdCatalogFixture(opts = {}) {
	const csvPath = opts.csvPath ?? FIXTURE_CSV;
	const text = fs.readFileSync(csvPath, 'utf8');
	const lines = text.trim().split('\n');
	if (lines.length < 2) {
		throw new Error(`Feed beta fixture empty: ${csvPath}`);
	}
	const header = parseCsvLine(lines[0]);
	const rows = [];
	for (let i = 1; i < lines.length; i += 1) {
		const cells = parseCsvLine(lines[i]);
		if (cells.length !== header.length) continue;
		/** @type {Record<string, string>} */
		const record = {};
		for (let c = 0; c < header.length; c += 1) {
			record[header[c].trim()] = cells[c];
		}
		rows.push(recordToFeedRow(record));
	}
	return {
		rows,
		manifestPath: path.join(path.dirname(csvPath), 'manifest.json')
	};
}

/**
 * Build score context newcomer sets from fixture author_created_at (no DB).
 * @param {object[]} catalog
 * @param {number} nowMs
 * @param {number} newcomerDays
 */
export function buildProdCatalogScoreContext(catalog, nowMs = Date.now(), newcomerDays = 14) {
	const cutoff = nowMs - newcomerDays * 24 * 60 * 60 * 1000;
	const newcomerAuthorIds = new Set();
	for (const row of catalog) {
		const created = Date.parse(String(row.author_created_at ?? ''));
		if (Number.isFinite(created) && created >= cutoff) {
			newcomerAuthorIds.add(String(row.user_id));
		}
	}
	return {
		nowMs,
		followingIds: new Set(),
		newcomerAuthorIds,
		newcomerHandles: new Set()
	};
}

/**
 * Pure recency page (legacy sitewide ordering proxy): newest `take` by feed created_at.
 * @param {object[]} catalog
 * @param {number} take
 */
export function chronologicalFeedPage(catalog, take = 20) {
	return catalog
		.slice()
		.sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)))
		.slice(0, take);
}
