import { loadAdminDataTable } from '/admin/shared/adminDataTable.js';

const truncate = (value, length = 48) => { const text = String(value ?? '').trim(); return text.length > length ? `${text.slice(0, length)}…` : text || '—'; };
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
const requestDatesCell = (row) => {
	const wrap = document.createElement('div');
	const sameFriendlyTime = row.first_request_at && row.last_request_at && relativeTime(row.first_request_at) === relativeTime(row.last_request_at);
	const last = document.createElement('div');
	if (row.first_request_at && sameFriendlyTime) last.append(dateCell(row.last_request_at));
	else last.append('Last ', dateCell(row.last_request_at));
	wrap.append(last);
	if (row.first_request_at && !sameFriendlyTime) {
		const first = document.createElement('small'); first.append('First ', dateCell(row.first_request_at)); wrap.append(first);
	}
	return wrap;
};
const linkCell = (href, label) => {
	const link = document.createElement('a'); link.href = href; link.textContent = label; return link;
};

const shareColumns = [
	{ key: 'viewed_at', label: 'Viewed', sortKey: 'viewed_at', render: (row) => dateCell(row.viewed_at) },
	{ key: 'sharer_label', label: 'Sharer', sortKey: 'sharer_user_id' },
	{ key: 'created_image_id', label: 'Creation', sortKey: 'created_image_id' },
	{ key: 'referer', label: 'Source', render: (row) => truncate(row.referer, 50) },
	{ key: 'location', label: 'Location', render: (row) => [row.city, row.region, row.country].filter(Boolean).join(', ') || '—' },
	{ key: 'anon_cid', label: 'Anonymous ID', sortKey: 'anon_cid', render: (row) => truncate(row.anon_cid, 18) }
];
const anonColumns = [
	{ key: 'last_request_at', label: 'Requested', sortKey: 'last_request_at', render: requestDatesCell },
	{ key: 'anon_cid', label: 'Anonymous ID', sortKey: 'anon_cid', render: (row) => truncate(row.anon_cid, 20) },
	{ key: 'request_count', label: 'Requests', sortKey: 'request_count' },
	{ key: 'source', label: 'Source', render: (row) => row.source || (row.from_share ? 'share' : '—') }
];
const tryColumns = [
	{ key: 'created_at', label: 'Requested', sortKey: 'created_at', render: (row) => dateCell(row.created_at) },
	{ key: 'status', label: 'Status' },
	{ key: 'prompt', label: 'Prompt', render: (row) => truncate(row.prompt, 64) }
];
const blogColumns = [
	{ key: 'viewed_at', label: 'Viewed', sortKey: 'viewed_at', render: (row) => dateCell(row.viewed_at) },
	{ key: 'post_label', label: 'Post', sortKey: 'post_slug', render: (row) => truncate(row.post_label || row.post_slug, 40) },
	{ key: 'source_label', label: 'Campaign', sortKey: 'campaign_id' }
];

const configs = [
	['[data-share-table]', '/api/admin-tools/share-views', shareColumns, { defaultSortBy: 'viewed_at', emptyMessage: 'No share page views yet.', onRowClick: showShareDetails }],
	['[data-anon-table]', '/api/admin-tools/anonymous-users', anonColumns, { itemsKey: 'anonCids', defaultSortBy: 'last_request_at', emptyMessage: 'No try flow requests yet.', onRowClick: showAnonymousRequests }],
	['[data-try-table]', '/api/admin-tools/try-requests', tryColumns, { defaultSortBy: 'created_at', emptyMessage: 'No try requests yet.', onRowClick: (row) => showRecordDetails('Try request', row) }],
	['[data-blog-table]', '/api/admin-tools/blog-views', blogColumns, { defaultSortBy: 'viewed_at', emptyMessage: 'No blog page views yet.', onRowClick: (row) => showRecordDetails('Blog view', row) }]
];

for (const [selector, fetchUrl, columns, extra] of configs) {
	const container = document.querySelector(selector);
	if (container) loadAdminDataTable(container, { fetchUrl, itemsKey: extra.itemsKey || 'items', pageSize: 25, columns, ariaLabel: selector, ...extra });
}

const dialog = document.querySelector('[data-anon-dialog]');
const dialogTitle = document.querySelector('[data-anon-dialog-title]');
const dialogBody = document.querySelector('[data-anon-dialog-body]');
document.querySelector('[data-anon-dialog-close]')?.addEventListener('click', () => dialog?.close());
dialog?.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

const shareDialog = document.querySelector('[data-share-dialog]');
const shareDialogBody = document.querySelector('[data-share-dialog-body]');
document.querySelector('[data-share-dialog-close]')?.addEventListener('click', () => shareDialog?.close());
shareDialog?.addEventListener('click', (event) => { if (event.target === shareDialog) shareDialog.close(); });
const recordDialog = document.querySelector('[data-record-dialog]');
const recordDialogTitle = document.querySelector('[data-record-dialog-title]');
const recordDialogBody = document.querySelector('[data-record-dialog-body]');
document.querySelector('[data-record-dialog-close]')?.addEventListener('click', () => recordDialog?.close());
recordDialog?.addEventListener('click', (event) => { if (event.target === recordDialog) recordDialog.close(); });

function appendDetails(container, fields) {
	const details = document.createElement('dl'); details.className = 'admin-user-details';
	for (const [label, value] of fields) {
		const term = document.createElement('dt'); term.textContent = label;
		const description = document.createElement('dd');
		if (value instanceof Node) description.append(value); else description.textContent = value == null || value === '' ? '—' : String(value);
		details.append(term, description);
	}
	container.append(details);
}

function showShareDetails(row) {
	if (!shareDialog || !shareDialogBody) return;
	shareDialogBody.replaceChildren();
	const fields = [
		['Viewed', exactTime(row.viewed_at)], ['Sharer', row.sharer_label || `#${row.sharer_user_id ?? '—'}`],
		['Creator', row.creator_label || `#${row.created_by_user_id ?? '—'}`], ['Anonymous ID', row.anon_cid || '—'],
		['Client ID', row.prsn_cid || '—'], ['Source', row.referer || '—'], ['Location', [row.city, row.region, row.country].filter(Boolean).join(', ') || '—'],
		['IP', row.ip || '—'], ['IP source', row.ip_source || '—'], ['User agent', row.user_agent || '—'], ['Cloudflare Ray ID', row.cf_ray || '—']
	];
	fields.push(['Creation', row.created_image_id ? linkCell(`/creations/${encodeURIComponent(row.created_image_id)}`, `Open creation ${row.created_image_id}`) : '—']);
	appendDetails(shareDialogBody, fields);
	shareDialog.showModal();
}

function showRecordDetails(kind, row) {
	if (!recordDialog || !recordDialogBody) return;
	recordDialogTitle.textContent = kind === 'Try request' ? `Try request #${row.id}` : 'Blog view details';
	recordDialogBody.replaceChildren();
	let fields;
	if (kind === 'Try request') {
		fields = [
			['Requested', exactTime(row.created_at)], ['Status', row.status], ['Prompt', row.prompt], ['Anonymous ID', row.anon_cid],
			['Client ID', row.prsn_cid], ['Fulfilled', exactTime(row.fulfilled_at)], ['Image', row.image?.id ? `#${row.image.id} · ${row.image.status || '—'}${row.image.width && row.image.height ? ` · ${row.image.width} × ${row.image.height}` : ''}` : '—'],
			['IP', row.ip], ['Location', [row.city, row.region, row.country].filter(Boolean).join(', ')], ['User agent', row.user_agent], ['Cloudflare Ray ID', row.cf_ray]
		];
		if (row.image?.image_url) fields.push(['Image link', linkCell(row.image.image_url, 'Open generated image')]);
	} else {
		const blogHref = row.post_slug ? `/blog/${String(row.post_slug).split('/').filter(Boolean).map(encodeURIComponent).join('/')}` : null;
		fields = [
			['Viewed', exactTime(row.viewed_at)], ['Post', blogHref ? linkCell(blogHref, row.post_label || row.post_slug) : row.post_label || row.post_slug],
			['Campaign', row.source_label], ['Campaign ID', row.campaign_id], ['Anonymous ID', row.anon_cid], ['Client ID', row.prsn_cid],
			['Referrer', row.referer], ['Location', [row.city, row.region, row.country].filter(Boolean).join(', ')], ['IP', row.ip],
			['IP source', row.ip_source], ['User agent', row.user_agent], ['Cloudflare Ray ID', row.cf_ray]
		];
	}
	appendDetails(recordDialogBody, fields);
	recordDialog.showModal();
}

async function showAnonymousRequests(summary) {
	const cid = summary.anon_cid;
	if (!dialog || !dialogBody) return;
	dialogTitle.textContent = `Requests for ${truncate(cid, 28)}`;
	dialogBody.replaceChildren(Object.assign(document.createElement('p'), { className: 'admin-status admin-status--loading', textContent: 'Loading…' }));
	dialog.showModal();
	try {
		const response = await fetch(`/api/admin-tools/anonymous-users/${encodeURIComponent(cid)}`, { credentials: 'same-origin' });
		if (!response.ok) throw new Error(`Request failed (${response.status})`);
		const data = await response.json();
		const requests = Array.isArray(data.requests) ? data.requests : [];
		dialogBody.replaceChildren();
		appendDetails(dialogBody, [
			['Anonymous ID', summary.anon_cid], ['Client ID', summary.prsn_cid], ['First request', exactTime(summary.first_request_at)],
			['Last request', exactTime(summary.last_request_at)], ['Request count', summary.request_count], ['Source', summary.source || (summary.from_share ? 'share' : '—')],
			['Transitioned user', summary.transitioned_user_name ? linkCell(`/p/${encodeURIComponent(summary.transitioned_user_name)}`, `@${summary.transitioned_user_name}`) : summary.transitioned_user_id ? `User ${summary.transitioned_user_id}` : '—'],
			['IP', summary.ip], ['Location', [summary.city, summary.region, summary.country].filter(Boolean).join(', ')], ['User agent', summary.user_agent], ['Cloudflare Ray ID', summary.cf_ray]
		]);
		if (!requests.length) { dialogBody.append(Object.assign(document.createElement('p'), { className: 'admin-status', textContent: 'No requests.' })); return; }
		for (const request of requests) {
			const card = document.createElement('article');
			card.className = 'admin-card';
			const prompt = document.createElement('p'); prompt.className = 'admin-card__title'; prompt.textContent = request.prompt || 'No prompt';
			const meta = document.createElement('p'); meta.className = 'admin-card__meta'; meta.textContent = `${relativeTime(request.created_at)} · ${request.status || 'unknown'}${request.fulfilled_at ? ` · fulfilled ${relativeTime(request.fulfilled_at)}` : ''}`;
			const detail = document.createElement('p'); detail.className = 'admin-card__detail';
			const parts = [`Request #${request.id}`, request.created_image_anon_id ? `Image #${request.created_image_anon_id}` : null, request.prsn_cid ? `Client ${request.prsn_cid}` : null, request.ip ? `IP ${request.ip}` : null, [request.city, request.region, request.country].filter(Boolean).join(', ') || null].filter(Boolean);
			detail.textContent = parts.join(' · ');
			card.append(prompt, meta, detail);
			if (request.image?.image_url) {
				const actions = document.createElement('div'); actions.className = 'admin-card__actions';
				const link = document.createElement('a'); link.className = 'admin-button'; link.href = request.image.image_url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open image'; actions.append(link);
				if (request.image.width && request.image.height) { const size = document.createElement('span'); size.className = 'admin-card__detail'; size.textContent = `${request.image.width} × ${request.image.height}`; actions.append(size); }
				card.append(actions);
			}
			dialogBody.append(card);
		}
	} catch (error) {
		dialogBody.replaceChildren(Object.assign(document.createElement('p'), { className: 'admin-status admin-status--error', textContent: error.message || 'Could not load requests.' }));
	}
}

async function copyText(text) {
	if (navigator.clipboard?.writeText) {
		try { await navigator.clipboard.writeText(text); return; } catch { /* Use the document fallback. */ }
	}
	const textarea = document.createElement('textarea');
	textarea.value = text; textarea.setAttribute('readonly', ''); textarea.style.position = 'fixed'; textarea.style.top = '-1000px';
	document.body.append(textarea); textarea.select(); textarea.setSelectionRange(0, textarea.value.length);
	const copied = document.execCommand('copy'); textarea.remove();
	if (!copied) throw new Error('Copy to clipboard failed.');
}

async function fetchAll(url, itemsKey = 'items') {
	const all = [];
	for (let offset = 0; ; offset += 100) {
		const params = new URLSearchParams({ limit: '100', offset: String(offset), sort_by: 'created_at', sort_dir: 'desc' });
		const response = await fetch(`${url}?${params}`, { credentials: 'same-origin' });
		if (!response.ok) throw new Error(`Request failed (${response.status})`);
		const data = await response.json();
		const items = Array.isArray(data[itemsKey]) ? data[itemsKey] : [];
		all.push(...items);
		if (!items.length || all.length >= Number(data.total || 0)) return all;
	}
}

for (const button of document.querySelectorAll('[data-export]')) {
	button.addEventListener('click', async () => {
		const kind = button.dataset.export;
		const status = document.querySelector(`[data-export-status="${kind.startsWith('anon-') ? 'anonymous' : kind}"]`);
		button.disabled = true;
		try {
			if (status) status.textContent = 'Preparing export…';
			let payload;
			if (kind === 'share-views') {
				const items = await fetchAll('/api/admin-tools/share-views');
				payload = { export_version: 1, exported_at: new Date().toISOString(), scope: '/analytics#shares', item_count: items.length, data: { shareViews: items } };
			} else if (kind === 'blog-views') {
				const items = await fetchAll('/api/admin-tools/blog-views');
				payload = { export_version: 1, exported_at: new Date().toISOString(), scope: '/analytics#blog', item_count: items.length, data: { blogViews: items } };
			} else {
				const anonCids = await fetchAll('/api/admin-tools/anonymous-users', 'anonCids');
				if (kind === 'anon-summary') payload = { export_version: 1, exported_at: new Date().toISOString(), scope: '/analytics#anonymous (summary)', item_count: anonCids.length, data: { anonCids } };
				else {
					const selected = anonCids.slice(0, 30);
					const anonRequestsByCid = [];
					for (let index = 0; index < selected.length; index++) {
						if (status) status.textContent = `Fetching requests… (${index + 1}/${selected.length})`;
						const response = await fetch(`/api/admin-tools/anonymous-users/${encodeURIComponent(selected[index].anon_cid)}`, { credentials: 'same-origin' });
						if (!response.ok) throw new Error(`Request detail failed (${response.status})`);
						const data = await response.json();
						anonRequestsByCid.push({ anon_cid: data.anon_cid, requests: data.requests || [] });
					}
					payload = { export_version: 1, exported_at: new Date().toISOString(), scope: '/analytics#anonymous (expanded)', anon_cids_total: anonCids.length, anon_cids_included: anonRequestsByCid.length, truncated: anonCids.length > anonRequestsByCid.length, truncation_note: anonCids.length > anonRequestsByCid.length ? 'Expanded export is capped at 30 anonymous IDs.' : null, data: { anonRequestsByCid } };
				}
			}
			const text = `PARASCENE_ADMIN_EXPORT\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
			await copyText(text);
			window.__parasceneAdminChatGPTExport = text;
			if (status) status.textContent = 'Copied export to clipboard.';
		} catch (error) {
			if (status) status.textContent = `Export failed: ${error.message || error}`;
		} finally { button.disabled = false; }
	});
}
