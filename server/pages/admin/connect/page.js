import { loadAdminDataTable } from '/admin/shared/adminDataTable.js';

const $ = (selector) => document.querySelector(selector);
const serverDialog = $('[data-server-dialog]');
const serverFields = $('[data-server-fields]');
const serverStatus = $('[data-server-status]');
const serverForm = $('[data-server-form]');
const threadDialog = $('[data-thread-dialog]');
const threadDetails = $('[data-thread-details]');
const threadStatus = $('[data-thread-status]');
let selectedServer = null;
let selectedThread = null;
let serverTable;
let threadTable;

function setStatus(node, message = '', error = false) {
	node.textContent = message;
	node.classList.toggle('admin-status--error', error);
}

async function request(url, options = {}) {
	const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
	return data;
}

function field(labelText, name, value, type = 'text') {
	const label = document.createElement('label');
	label.className = 'admin-field';
	const title = document.createElement('span');
	title.className = 'admin-field__label';
	title.textContent = labelText;
	const input = type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
	if (type !== 'textarea') input.type = type;
	input.name = name;
	input.value = value == null ? '' : String(value);
	label.append(title, input);
	return label;
}

function serverFormValues() {
	const values = new FormData(serverForm);
	return {
		user_id: Number(values.get('user_id')),
		name: String(values.get('name') || '').trim(),
		status: String(values.get('status') || '').trim(),
		server_url: String(values.get('server_url') || '').trim(),
		description: String(values.get('description') || '').trim() || null,
		auth_token: String(values.get('auth_token') || ''),
		status_date: String(values.get('status_date') || '').trim() || null,
		members_count: Number(values.get('members_count')),
		server_config: String(values.get('server_config') || '').trim() || null
	};
}

async function openServer(row) {
	selectedServer = row;
	serverFields.replaceChildren();
	setStatus(serverStatus, 'Loading server details…');
	serverDialog.showModal();
	try {
		const { server } = await request(`/api/admin-tools/servers/${encodeURIComponent(row.id)}`);
		selectedServer = server;
		$('[data-server-title]').textContent = server.name || `Server ${server.id}`;
		serverFields.replaceChildren(
			field('Owner user ID', 'user_id', server.user_id, 'number'),
			field('Name', 'name', server.name),
			field('Status', 'status', server.status),
			field('Provider URL', 'server_url', server.server_url, 'url'),
			field('Authentication token', 'auth_token', server.auth_token, 'password'),
			field('Status date', 'status_date', server.status_date),
			field('Member count', 'members_count', server.members_count, 'number'),
			field('Description', 'description', server.description, 'textarea'),
			field('Server configuration (JSON)', 'server_config', JSON.stringify(server.server_config || {}, null, 2), 'textarea'),
		);
		const details = document.createElement('p');
		details.className = 'admin-card__detail';
		const created = server.created_at ? new Date(server.created_at).toLocaleString() : '—';
		details.textContent = `ID ${server.id} · ${Number(server.members_count) || 0} members · Created ${created}`;
		serverFields.append(details);
		setStatus(serverStatus);
	} catch (error) { setStatus(serverStatus, error.message, true); }
}

serverForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	if (!selectedServer?.id) return;
	const save = serverForm.querySelector('[type="submit"]');
	save.disabled = true;
	setStatus(serverStatus, 'Saving…');
	try {
		const values = serverFormValues();
		if (!values.name || !values.server_url) throw new Error('Name and provider URL are required.');
		if (values.server_config) JSON.parse(values.server_config);
		const result = await request(`/api/admin-tools/servers/${encodeURIComponent(selectedServer.id)}`, { method: 'PUT', body: JSON.stringify(values) });
		selectedServer = result.server || selectedServer;
		setStatus(serverStatus, 'Server saved.');
		await serverTable?.refresh();
	} catch (error) { setStatus(serverStatus, error.message, true); }
	finally { save.disabled = false; }
});

async function runServerAction(kind, button) {
	if (!selectedServer?.id) return;
	button.disabled = true;
	setStatus(serverStatus, kind === 'test' ? 'Testing provider…' : 'Refreshing capabilities…');
	try {
		const path = `/api/servers/${encodeURIComponent(selectedServer.id)}/${kind}`;
		const result = await request(path, { method: 'POST', ...(kind === 'refresh' ? { body: JSON.stringify({}) } : {}) });
		if (kind === 'refresh') await serverTable?.refresh();
		setStatus(serverStatus, kind === 'test' ? `Connection successful · ${result.server_url}` : 'Provider capabilities refreshed.');
	} catch (error) { setStatus(serverStatus, error.message, true); }
	finally { button.disabled = false; }
}
$('[data-server-test]').addEventListener('click', (event) => void runServerAction('test', event.currentTarget));
$('[data-server-refresh]').addEventListener('click', (event) => void runServerAction('refresh', event.currentTarget));
$('[data-server-close]').addEventListener('click', () => serverDialog.close());

function openThread(thread) {
	selectedThread = thread;
	threadDetails.replaceChildren();
	const entries = [
		['Thread ID', thread.id], ['Type', thread.type], ['Channel', thread.channel_slug || '—'],
		['Direct message pair', thread.dm_pair_key || '—'], ['Created', thread.created_at ? new Date(thread.created_at).toLocaleString() : '—']
	];
	const list = document.createElement('dl');
	list.className = 'admin-user-details';
	for (const [key, value] of entries) {
		const term = document.createElement('dt'); term.textContent = key;
		const description = document.createElement('dd'); description.textContent = String(value ?? '—');
		list.append(term, description);
	}
	threadDetails.append(list);
	setStatus(threadStatus);
	threadDialog.showModal();
}

$('[data-thread-delete]').addEventListener('click', async (event) => {
	if (!selectedThread?.id) return;
	if (!window.confirm(`Delete conversation ${selectedThread.channel_slug ? `#${selectedThread.channel_slug}` : selectedThread.id} and all of its messages?`)) return;
	const button = event.currentTarget;
	button.disabled = true;
	setStatus(threadStatus, 'Deleting conversation…');
	try {
		const result = await request(`/api/admin-tools/connect-threads/${encodeURIComponent(selectedThread.id)}`, { method: 'DELETE' });
		setStatus(threadStatus, `Conversation deleted · ${result.removed_messages ?? 0} messages removed.`);
		await threadTable?.refresh();
		window.setTimeout(() => threadDialog.close(), 500);
	} catch (error) { setStatus(threadStatus, error.message, true); }
	finally { button.disabled = false; }
});
$('[data-thread-close]').addEventListener('click', () => threadDialog.close());

serverTable = await loadAdminDataTable($('[data-servers-table]'), {
	fetchUrl: '/api/admin-tools/servers', itemsKey: 'items', pageSize: 25,
	ariaLabel: 'Connected provider servers', rowLabel: 'server details', getRowLabel: (row) => `Open ${row.name || `server ${row.id}`}`,
	onRowClick: (row) => void openServer(row), defaultSortBy: 'name', defaultSortDir: 'asc',
	columns: [
		{ key: 'name', label: 'Server', sortKey: 'name', render: (row) => row.name || `Server ${row.id}` },
		{ key: 'status', label: 'Status', sortKey: 'status' },
		{ key: 'members_count', label: 'Members', sortKey: 'members_count', render: (row) => row.members_count == null ? '—' : Number(row.members_count).toLocaleString() },
		{ key: 'created_at', label: 'Created', sortKey: 'created_at', render: (row) => row.created_at ? new Date(row.created_at).toLocaleDateString() : '—' }
	]
});

threadTable = await loadAdminDataTable($('[data-threads-table]'), {
	fetchUrl: '/api/admin-tools/connect-threads', itemsKey: 'items', pageSize: 25,
	ariaLabel: 'Moderatable Connect conversations', rowLabel: 'conversation details', getRowLabel: (row) => `Open conversation ${row.channel_slug ? `#${row.channel_slug}` : row.id}`,
	onRowClick: openThread, defaultSortBy: 'id', defaultSortDir: 'desc', emptyMessage: 'No removable conversations.',
	columns: [
		{ key: 'channel_slug', label: 'Conversation', sortKey: 'channel_slug', render: (row) => row.channel_slug ? `#${row.channel_slug}` : `Thread ${row.id}` },
		{ key: 'created_at', label: 'Created', sortKey: 'created_at', render: (row) => row.created_at ? new Date(row.created_at).toLocaleDateString() : '—' }
	]
});
