import { loadAdminDataTable } from '/admin/shared/adminDataTable.js';

const time = (value) => value ? new Date(value).toLocaleString() : '—';
const configs = [
	['[data-share-table]', '/api/admin-tools/share-views', [
		{ key: 'viewed_at', label: 'Viewed', sortKey: 'viewed_at', render: (row) => time(row.viewed_at) },
		{ key: 'sharer_user_id', label: 'Sharer' }, { key: 'created_image_id', label: 'Creation' },
		{ key: 'created_by_user_id', label: 'Creator' }, { key: 'referer', label: 'Referrer' }, { key: 'anon_cid', label: 'Anonymous ID' }
	]],
	['[data-try-table]', '/api/admin-tools/try-requests', [
		{ key: 'created_at', label: 'Requested', sortKey: 'created_at', render: (row) => time(row.created_at) },
		{ key: 'status', label: 'Status', sortKey: 'status' }, { key: 'prompt', label: 'Prompt' }, { key: 'anon_cid', label: 'Anonymous ID' }
	]],
	['[data-blog-table]', '/api/admin-tools/blog-views', [
		{ key: 'viewed_at', label: 'Viewed', sortKey: 'viewed_at', render: (row) => time(row.viewed_at) },
		{ key: 'post_slug', label: 'Post', sortKey: 'post_slug' }, { key: 'campaign_id', label: 'Source', sortKey: 'campaign_id' },
		{ key: 'referer', label: 'Referrer' }, { key: 'anon_cid', label: 'Anonymous ID' }
	]]
];
for (const [selector, fetchUrl, columns] of configs) loadAdminDataTable(document.querySelector(selector), { fetchUrl, itemsKey: 'items', pageSize: 25, columns });
