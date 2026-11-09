import { loadAdminDataTable } from '/admin/shared/adminDataTable.js';

const short = (value, max = 64) => {
	const text = String(value ?? '').trim();
	return text.length > max ? `${text.slice(0, max)}…` : text || '—';
};
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

const dialog = document.querySelector('[data-job-dialog]');
const dialogTitle = document.querySelector('[data-job-dialog-title]');
const dialogBody = document.querySelector('[data-job-dialog-body]');
document.querySelector('[data-job-dialog-close]')?.addEventListener('click', () => dialog?.close());
dialog?.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

function appendDetails(fields) {
	const details = document.createElement('dl');
	details.className = 'admin-user-details';
	for (const [label, value] of fields) {
		const term = document.createElement('dt'); term.textContent = label;
		const description = document.createElement('dd'); description.textContent = value == null || value === '' ? '—' : String(value);
		details.append(term, description);
	}
	dialogBody.append(details);
}

function appendJsonSection(label, value) {
	const section = document.createElement('section');
	section.className = 'admin-job-detail';
	const heading = document.createElement('h3'); heading.textContent = label;
	const pre = document.createElement('pre'); pre.className = 'admin-job-detail__json';
	pre.textContent = value == null ? '—' : JSON.stringify(value, null, 2);
	section.append(heading, pre);
	dialogBody.append(section);
}

function showJobDetails(row) {
	dialogTitle.textContent = `Job #${row.id}`;
	dialogBody.replaceChildren();
	appendDetails([
		['ID', row.id], ['Type', row.job_type], ['Status', row.status], ['Created', exactTime(row.created_at)], ['Updated', exactTime(row.updated_at)],
		['Error', row.meta?.error || row.meta?.error_message || row.meta?.error_code || '—']
	]);
	appendJsonSection('Arguments', row.args);
	appendJsonSection('Metadata', row.meta);
	dialog.showModal();
}

function showFailureDetails(row) {
	dialogTitle.textContent = `Try failure #${row.id}`;
	dialogBody.replaceChildren();
	appendDetails([
		['ID', row.id], ['Created', exactTime(row.created_at)], ['Status', row.status || 'failed'], ['Prompt', row.prompt],
		['Error', row.meta?.error || row.meta?.error_message || row.meta?.error_code || '—']
	]);
	appendJsonSection('Metadata', row.meta);
	dialog.showModal();
}

loadAdminDataTable(document.querySelector('[data-jobs-table]'), {
	fetchUrl: '/api/admin-tools/jobs', itemsKey: 'jobs', pageSize: 25, defaultSortBy: 'created_at', defaultSortDir: 'desc',
	emptyMessage: 'No jobs yet.', ariaLabel: 'Jobs', onRowClick: showJobDetails,
	columns: [
		{ key: 'job_type', label: 'Type', sortKey: 'job_type', className: 'admin-jobs-cell-type', render: (row) => short(row.job_type, 36) },
		{ key: 'status', label: 'Status', sortKey: 'status', className: 'admin-jobs-cell-status' },
		{ key: 'created_at', label: 'Created', sortKey: 'created_at', className: 'admin-jobs-cell-date', render: (row) => dateCell(row.created_at) },
		{ key: 'updated_at', label: 'Updated', sortKey: 'updated_at', className: 'admin-jobs-cell-date', render: (row) => dateCell(row.updated_at) }
	]
});

loadAdminDataTable(document.querySelector('[data-failures-table]'), {
	fetchUrl: '/api/admin-tools/try-failures', itemsKey: 'items', pageSize: 50, defaultSortBy: 'created_at', defaultSortDir: 'desc',
	emptyMessage: 'No recent try failures.', ariaLabel: 'Try failures', onRowClick: showFailureDetails,
	columns: [
		{ key: 'created_at', label: 'Created', className: 'admin-jobs-failure-created', render: (row) => dateCell(row.created_at) },
		{ key: 'prompt', label: 'Prompt', className: 'admin-jobs-failure-prompt', render: (row) => short(row.prompt, 48) },
		{ key: 'meta', label: 'Error', className: 'admin-jobs-failure-error', render: (row) => short(row.meta?.error || row.meta?.error_message || row.meta?.error_code, 52) }
	]
});
