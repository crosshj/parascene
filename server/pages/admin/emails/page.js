import { loadAdminDataTable } from '/admin/shared/adminDataTable.js';

loadAdminDataTable(document.querySelector('[data-email-sends]'), { fetchUrl: '/api/admin-tools/email-sends', itemsKey: 'items', pageSize: 25, columns: [
	{ key: 'created_at', label: 'Sent', sortKey: 'created_at', render: (row) => row.created_at ? new Date(row.created_at).toLocaleString() : '—' },
	{ key: 'user_id', label: 'User' }, { key: 'campaign', label: 'Campaign', sortKey: 'campaign' }, { key: 'id', label: 'ID' }
] });

const form = document.querySelector('[data-email-settings]');
const fields = document.querySelector('[data-email-settings-fields]');
const status = document.querySelector('[data-email-settings-status]');
const definitions = [
	['email_use_test_recipient', 'Send to Resend test address', 'checkbox'], ['email_dry_run', 'Dry run (record without sending)', 'checkbox'],
	['digest_utc_windows', 'Digest windows (UTC)', 'text'], ['max_digests_per_user_per_day', 'Max digests per user per day', 'number'],
	['digest_activity_hours_lookback', 'Activity lookback (hours)', 'number'], ['welcome_email_delay_hours', 'Welcome email delay (hours)', 'number'],
	['reengagement_inactive_days', 'Re-engagement inactivity (days)', 'number'], ['reengagement_cooldown_days', 'Re-engagement cooldown (days)', 'number'],
	['creation_highlight_lookback_hours', 'Creation highlight lookback (hours)', 'number'], ['creation_highlight_cooldown_days', 'Creation highlight cooldown (days)', 'number'],
	['creation_highlight_min_comments', 'Minimum comments for highlight', 'number']
];
try {
	const response = await fetch('/api/admin-tools/email-settings', { credentials: 'same-origin' });
	const values = await response.json();
	if (!response.ok) throw new Error(values.error || `Request failed (${response.status})`);
	for (const [key, label, type] of definitions) {
		const wrapper = document.createElement('div'); wrapper.className = 'admin-field';
		const input = document.createElement('input'); input.className = 'admin-input'; input.id = `email-${key}`; input.name = key; input.type = type;
		if (type === 'checkbox') input.checked = String(values[key] ?? 'false') === 'true'; else input.value = values[key] ?? '';
		const caption = document.createElement('label'); caption.className = 'admin-field__label'; caption.htmlFor = input.id; caption.textContent = label;
		wrapper.append(caption, input); fields.append(wrapper);
	}
} catch (error) { status.textContent = error.message; status.classList.add('admin-status--error'); }
form.addEventListener('submit', async (event) => {
	event.preventDefault(); status.textContent = 'Saving…'; status.classList.remove('admin-status--error');
	const body = Object.fromEntries(definitions.map(([key, , type]) => [key, type === 'checkbox' ? form.elements[key].checked : form.elements[key].value]));
	try {
		const response = await fetch('/api/admin-tools/email-settings', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
		const result = await response.json(); if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
		status.textContent = 'Saved.';
	} catch (error) { status.textContent = error.message; status.classList.add('admin-status--error'); }
});
