import { loadAdminDataTable } from '/admin/shared/adminDataTable.js';

loadAdminDataTable(document.querySelector('[data-servers-table]'), { fetchUrl: '/api/admin-tools/servers', itemsKey: 'items', pageSize: 25, columns: [
	{ key: 'id', label: 'ID' }, { key: 'name', label: 'Server' }, { key: 'status', label: 'Status' },
	{ key: 'members_count', label: 'Members' }, { key: 'created_at', label: 'Created', render: (row) => row.created_at ? new Date(row.created_at).toLocaleDateString() : '—' }
] });
