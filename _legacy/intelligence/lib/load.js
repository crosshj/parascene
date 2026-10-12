/**
 * Load creation data from production Supabase.
 */

import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../../scripts/repo-root.cjs';

loadEnv();

const PAGE_SIZE = 1000;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} table
 * @param {string} columns
 * @param {{ filter?: (q: import('@supabase/supabase-js').PostgrestFilterBuilder) => import('@supabase/supabase-js').PostgrestFilterBuilder }} [opts]
 */
async function fetchAllRows(client, table, columns, opts = {}) {
	const out = [];
	let from = 0;
	while (true) {
		const to = from + PAGE_SIZE - 1;
		let q = client.from(table).select(columns).range(from, to);
		if (opts.filter) q = opts.filter(q);
		const { data, error } = await q;
		if (error) throw new Error(`Supabase ${table}: ${error.message}`);
		const rows = Array.isArray(data) ? data : [];
		out.push(...rows);
		if (rows.length < PAGE_SIZE) break;
		from += rows.length;
	}
	return out;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 */
async function loadRemixCounts(client) {
	const rows = await fetchAllRows(client, 'prsn_created_images', 'id, meta', {
		filter: (q) => q.not('meta->>mutate_of_id', 'is', null)
	});
	/** @type {Map<number, number>} */
	const counts = new Map();
	for (const row of rows) {
		const meta = typeof row.meta === 'object' ? row.meta : null;
		const parentId = Number(meta?.mutate_of_id);
		if (!Number.isFinite(parentId) || parentId <= 0) continue;
		counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
	}
	return counts;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 */
async function loadShareCounts(client) {
	const rows = await fetchAllRows(client, 'prsn_share_page_views', 'created_image_id');
	/** @type {Map<number, number>} */
	const counts = new Map();
	for (const row of rows) {
		const id = Number(row.created_image_id);
		if (!Number.isFinite(id) || id <= 0) continue;
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return counts;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 */
async function loadCountMap(client, table, idCol, countCol) {
	const rows = await fetchAllRows(client, table, `${idCol}, ${countCol}`);
	/** @type {Map<number, number>} */
	const map = new Map();
	for (const row of rows) {
		const id = Number(row[idCol]);
		const count = Number(row[countCol]);
		if (!Number.isFinite(id) || id <= 0) continue;
		map.set(id, Number.isFinite(count) ? count : 0);
	}
	return map;
}

/**
 * @returns {Promise<{ rows: object[], remixCounts: Map<number, number>, shareCounts: Map<number, number>, likeCounts: Map<number, number>, commentCounts: Map<number, number> }>}
 */
export async function loadCreations() {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
	}
	const client = createClient(url, key, { auth: { persistSession: false } });

	console.log('[intelligence] Loading published creations from Supabase…');
	const rows = await fetchAllRows(
		client,
		'prsn_created_images',
		'id, user_id, title, description, meta, published, published_at, created_at',
		{ filter: (q) => q.eq('published', true) }
	);
	console.log(`[intelligence] ${rows.length} published creations`);

	console.log('[intelligence] Loading engagement counts…');
	const [likeCounts, commentCounts, shareCounts, remixCounts] = await Promise.all([
		loadCountMap(client, 'prsn_created_image_like_counts', 'created_image_id', 'like_count'),
		loadCountMap(client, 'prsn_created_image_comment_counts', 'created_image_id', 'comment_count'),
		loadShareCounts(client),
		loadRemixCounts(client)
	]);

	return { rows, likeCounts, commentCounts, shareCounts, remixCounts };
}

/**
 * @param {object} row
 * @param {Map<number, number>} likeCounts
 * @param {Map<number, number>} commentCounts
 * @param {Map<number, number>} shareCounts
 * @param {Map<number, number>} remixCounts
 */
export function countsForRow(row, likeCounts, commentCounts, shareCounts, remixCounts) {
	const id = Number(row.id);
	return {
		likeCount: likeCounts.get(id) ?? 0,
		commentCount: commentCounts.get(id) ?? 0,
		shareCount: shareCounts.get(id) ?? 0,
		remixCount: remixCounts.get(id) ?? 0,
		viewCount: null
	};
}
