import { loadAdminDataTable } from '/admin/shared/adminDataTable.js';

const exactTime = (value) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : '—';
const relativeTime = (value) => {
	if (!value || !Number.isFinite(new Date(value).getTime())) return '—';
	const seconds = (new Date(value).getTime() - Date.now()) / 1000;
	const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
	const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) || ['second', 1];
	return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(seconds / size), unit);
};
const dateCell = (value) => {
	const time = document.createElement('time');
	if (value) time.dateTime = value;
	time.title = exactTime(value);
	time.textContent = relativeTime(value);
	return time;
};

const dialog = document.querySelector('[data-unhandled-dialog]');
const dialogTitle = document.querySelector('[data-unhandled-dialog-title]');
const dialogBody = document.querySelector('[data-unhandled-dialog-body]');
document.querySelector('[data-unhandled-dialog-close]')?.addEventListener('click', () => dialog?.close());
dialog?.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

function showDetails(row) {
	dialogTitle.textContent = `${row.method} ${row.path_key}`;
	dialogBody.replaceChildren();
	const details = document.createElement('dl');
	details.className = 'admin-user-details';
	for (const [label, value] of [
		['Method', row.method],
		['Path', row.path_key],
		['Host', row.host],
		['Instance', row.app_version],
		['Hits', row.hit_count],
		['First seen', exactTime(row.first_seen_at)],
		['Last seen', exactTime(row.last_seen_at)],
		['Query keys', row.query_keys || '—'],
		['User agent', row.user_agent || '—']
	]) {
		const term = document.createElement('dt');
		term.textContent = label;
		const description = document.createElement('dd');
		description.textContent = value == null || value === '' ? '—' : String(value);
		details.append(term, description);
	}
	dialogBody.append(details);
	dialog.showModal();
}

loadAdminDataTable(document.querySelector('[data-unhandled-table]'), {
	fetchUrl: '/api/admin-tools/unhandled-requests',
	itemsKey: 'items',
	pageSize: 50,
	defaultSortBy: 'last_seen_at',
	defaultSortDir: 'desc',
	emptyMessage: 'No unhandled API requests.',
	errorMessage: 'Could not load unhandled requests. Apply server/db/schemas/supabase_16_unhandled_requests.sql if this page has never worked.',
	ariaLabel: 'Unhandled requests',
	onRowClick: showDetails,
	columns: [
		{ key: 'method', label: 'Method', sortKey: 'method' },
		{ key: 'path_key', label: 'Path', sortKey: 'path_key' },
		{ key: 'host', label: 'Host', sortKey: 'host' },
		{ key: 'app_version', label: 'Instance', sortKey: 'app_version' },
		{ key: 'hit_count', label: 'Hits', sortKey: 'hit_count' },
		{ key: 'last_seen_at', label: 'Last seen', sortKey: 'last_seen_at', render: (row) => dateCell(row.last_seen_at) }
	]
});
