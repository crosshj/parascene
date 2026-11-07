import { loadAdminDataTable } from '/admin/shared/adminDataTable.js';

const table = document.querySelector('[data-transitions-table]');
const form = document.querySelector('[data-algo-settings]');
const fields = document.querySelector('[data-algo-fields]');
const status = document.querySelector('[data-algo-status]');
const settings = [
	['related.recsys_weight', 'Recsys weight'], ['related.semantic_weight', 'Semantic weight'],
	['related.semantic_weight_no_click_next', 'Semantic weight without click-next'], ['related.semantic_distance_max', 'Maximum semantic distance'],
	['related.lineage_weight', 'Lineage weight'], ['related.lineage_min_slots', 'Lineage minimum slots'],
	['related.same_server_method_weight', 'Same server and method weight'], ['related.same_creator_weight', 'Same creator weight'],
	['related.fallback_weight', 'Fallback weight'], ['related.transition_cap_k', 'Transition cap per source'],
	['related.transition_decay_half_life_days', 'Transition decay half-life (days)'], ['related.transition_window_days', 'Transition window (days)'],
	['related.random_slots_per_batch', 'Random slots per batch'], ['related.batch_size', 'Batch size'],
	['related.candidate_cap_per_signal', 'Candidate cap per signal']
];
const time = (value) => value ? new Date(value).toLocaleString() : '—';
loadAdminDataTable(table, { fetchUrl: '/api/admin-tools/transitions', itemsKey: 'items', pageSize: 25, defaultSortBy: 'count', columns: [
	{ key: 'from_created_image_id', label: 'From', render: (row) => link(row.from_created_image_id) },
	{ key: 'to_created_image_id', label: 'To', render: (row) => link(row.to_created_image_id) },
	{ key: 'count', label: 'Clicks', sortKey: 'count' }, { key: 'last_updated', label: 'Last updated', sortKey: 'last_updated', render: (row) => time(row.last_updated) }
] });
function link(id) { const a = document.createElement('a'); a.href = `/creations/${encodeURIComponent(id)}`; a.textContent = String(id ?? '—'); return a; }
async function request(url, options) { const response = await fetch(url, { credentials: 'same-origin', ...options }); const body = await response.json(); if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`); return body; }
try {
	const data = await request('/api/admin-tools/related-settings');
	for (const [key, label] of settings) { const wrapper = document.createElement('div'); wrapper.className = 'admin-field'; const input = document.createElement('input'); input.className = 'admin-input'; input.name = key; input.type = 'number'; input.step = 'any'; input.value = data[key] ?? ''; const caption = document.createElement('label'); caption.className = 'admin-field__label'; caption.textContent = label; caption.htmlFor = `algo-${key.replaceAll('.', '-')}`; input.id = caption.htmlFor; wrapper.append(caption, input); fields.append(wrapper); }
} catch (error) { status.textContent = error.message; status.classList.add('admin-status--error'); }
form.addEventListener('submit', async (event) => { event.preventDefault(); status.textContent = 'Saving…'; status.classList.remove('admin-status--error'); const body = Object.fromEntries(new FormData(form)); try { await request('/api/admin-tools/related-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); status.textContent = 'Saved.'; } catch (error) { status.textContent = error.message; status.classList.add('admin-status--error'); } });
