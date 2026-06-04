#!/usr/bin/env node
/**
 * Export sitewide published feed_items to a minimal CSV for feed-beta tests.
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/export-feed-beta-catalog-fixture.js
 *   node scripts/export-feed-beta-catalog-fixture.js --out test/fixtures/feedBeta/prod-published-catalog.csv
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { REPO_ROOT, loadEnv } from './repo-root.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv();

const DEFAULT_OUT = path.join(REPO_ROOT, 'test/fixtures/feedBeta/prod-published-catalog.csv');
const PAGE_SIZE = 500;
const BETA_COLS =
	'id, created_at, created_image_id, title, summary, prsn_created_images!inner(user_id, unavailable_at, meta)';

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var ${name}`);
	return value;
}

function parseArgs(argv) {
	let out = DEFAULT_OUT;
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === '--out') {
			out = path.resolve(REPO_ROOT, argv[i + 1] ?? '');
			i += 1;
		}
	}
	return { out };
}

function parseMeta(raw) {
	if (!raw) return null;
	if (typeof raw === 'object') return raw;
	if (typeof raw === 'string' && raw) {
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	}
	return null;
}

function rowMediaType(meta) {
	const mediaType =
		meta && typeof meta.media_type === 'string' ? meta.media_type.trim().toLowerCase() : 'image';
	const hasVideoPath =
		meta &&
		typeof meta.video === 'object' &&
		typeof meta.video.file_path === 'string' &&
		meta.video.file_path.trim();
	return mediaType === 'video' && hasVideoPath ? 'video' : 'image';
}

function csvCell(value) {
	const s = value == null ? '' : String(value);
	if (/[",\n\r]/.test(s)) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

async function fetchAllFeedRows(client) {
	const table = 'prsn_feed_items';
	const rows = [];
	let offset = 0;
	while (true) {
		const { data, error } = await client
			.from(table)
			.select(BETA_COLS)
			.not('prsn_created_images.user_id', 'is', null)
			.is('prsn_created_images.unavailable_at', null)
			.order('created_at', { ascending: false })
			.range(offset, offset + PAGE_SIZE - 1);
		if (error) throw error;
		const page = Array.isArray(data) ? data : [];
		if (page.length === 0) break;
		rows.push(...page);
		if (page.length < PAGE_SIZE) break;
		offset += PAGE_SIZE;
	}
	return rows;
}

async function fetchCountMaps(client, createdImageIds) {
	const likeById = new Map();
	const commentById = new Map();
	const chunk = 200;
	for (let i = 0; i < createdImageIds.length; i += chunk) {
		const ids = createdImageIds.slice(i, i + chunk);
		const [likes, comments] = await Promise.all([
			client
				.from('prsn_created_image_like_counts')
				.select('created_image_id, like_count')
				.in('created_image_id', ids),
			client
				.from('prsn_created_image_comment_counts')
				.select('created_image_id, comment_count')
				.in('created_image_id', ids)
		]);
		if (likes.error) throw likes.error;
		if (comments.error) throw comments.error;
		for (const row of likes.data ?? []) {
			likeById.set(String(row.created_image_id), Number(row.like_count ?? 0));
		}
		for (const row of comments.data ?? []) {
			commentById.set(String(row.created_image_id), Number(row.comment_count ?? 0));
		}
	}
	return { likeById, commentById };
}

async function fetchAuthorCreatedAt(client, userIds) {
	const out = new Map();
	const chunk = 200;
	for (let i = 0; i < userIds.length; i += chunk) {
		const ids = userIds.slice(i, i + chunk);
		const { data, error } = await client
			.from('prsn_users')
			.select('id, created_at')
			.in('id', ids);
		if (error) throw error;
		for (const row of data ?? []) {
			out.set(String(row.id), row.created_at ?? '');
		}
	}
	return out;
}

function buildExportRows(rawRows, likeById, commentById, authorCreatedAt) {
	const out = [];
	for (const row of rawRows) {
		const ci = row.prsn_created_images;
		const createdImageId = row.created_image_id;
		if (createdImageId == null) continue;
		const userId = ci?.user_id;
		if (userId == null) continue;
		const meta = parseMeta(ci?.meta);
		const key = String(createdImageId);
		out.push({
			created_image_id: key,
			user_id: String(userId),
			created_at: row.created_at ?? '',
			like_count: likeById.get(key) ?? 0,
			comment_count: commentById.get(key) ?? 0,
			media_type: rowMediaType(meta),
			nsfw: meta && meta.nsfw ? '1' : '0',
			author_created_at: authorCreatedAt.get(String(userId)) ?? ''
		});
	}
	return out;
}

async function main() {
	const { out } = parseArgs(process.argv.slice(2));
	const client = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));

	const rawRows = await fetchAllFeedRows(client);
	const createdImageIds = [
		...new Set(
			rawRows.map((r) => r.created_image_id).filter((id) => id != null)
		)
	];
	const authorIds = [
		...new Set(
			rawRows
				.map((r) => r.prsn_created_images?.user_id)
				.filter((id) => id != null)
				.map((id) => Number(id))
				.filter((n) => Number.isFinite(n) && n > 0)
		)
	];

	const [{ likeById, commentById }, authorCreatedAt] = await Promise.all([
		fetchCountMaps(client, createdImageIds),
		fetchAuthorCreatedAt(client, authorIds)
	]);

	const exportRows = buildExportRows(rawRows, likeById, commentById, authorCreatedAt);
	const header =
		'created_image_id,user_id,created_at,like_count,comment_count,media_type,nsfw,author_created_at';
	const lines = exportRows.map((r) =>
		[
			r.created_image_id,
			r.user_id,
			r.created_at,
			r.like_count,
			r.comment_count,
			r.media_type,
			r.nsfw,
			r.author_created_at
		]
			.map(csvCell)
			.join(',')
	);

	await fs.mkdir(path.dirname(out), { recursive: true });
	await fs.writeFile(out, `${header}\n${lines.join('\n')}\n`, 'utf8');

	const manifestPath = path.join(path.dirname(out), 'manifest.json');
	const videoCount = exportRows.filter((r) => r.media_type === 'video').length;
	const manifest = {
		exported_at: new Date().toISOString(),
		source: 'prsn_feed_items + prsn_created_images (available, author set)',
		filter: 'feed_items with prsn_created_images.unavailable_at IS NULL',
		csv_file: path.basename(out),
		counts: {
			feed_items_raw: rawRows.length,
			rows_in_csv: exportRows.length,
			video_rows: videoCount
		},
		columns: header.split(',')
	};
	await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

	console.log(`Wrote ${exportRows.length} rows to ${out}`);
	console.log(`Videos: ${videoCount}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
