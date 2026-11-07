import { loadAdminDataTable } from '/admin/shared/adminDataTable.js';

const jobs = document.querySelector('[data-jobs-table]');
const failures = document.querySelector('[data-failures-table]');
loadAdminDataTable(jobs, { fetchUrl: '/api/admin-tools/jobs', itemsKey: 'jobs', pageSize: 25, defaultSortBy: 'created_at', columns: [
	{ key: 'id', label: 'ID', sortKey: 'id' }, { key: 'job_type', label: 'Type', sortKey: 'job_type' },
	{ key: 'status', label: 'Status', sortKey: 'status' }, { key: 'created_at', label: 'Created', sortKey: 'created_at' },
	{ key: 'updated_at', label: 'Updated', sortKey: 'updated_at' },
	{ key: 'meta', label: 'Details', render: (row) => row.meta?.error || row.meta?.duration_ms || '—' }
] });
loadAdminDataTable(failures, { fetchUrl: '/api/admin-tools/try-failures', itemsKey: 'items', pageSize: 50, columns: [
	{ key: 'id', label: 'ID' }, { key: 'prompt', label: 'Prompt' }, { key: 'created_at', label: 'When' },
	{ key: 'meta', label: 'Error', render: (row) => row.meta?.error || row.meta?.error_code || '—' }
] });
