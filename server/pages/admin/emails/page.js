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
const short = (value, length = 48) => {
	const text = String(value ?? '').trim();
	return text.length > length ? `${text.slice(0, length)}…` : text || '—';
};
const linkNode = (href, label) => { const link = document.createElement('a'); link.href = href; link.textContent = label; return link; };

const emailDialog = document.querySelector('[data-email-dialog]');
const emailDialogTitle = document.querySelector('[data-email-dialog-title]');
const emailDialogBody = document.querySelector('[data-email-dialog-body]');
document.querySelector('[data-email-dialog-close]')?.addEventListener('click', () => emailDialog?.close());
emailDialog?.addEventListener('click', (event) => { if (event.target === emailDialog) emailDialog.close(); });

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

function showSendDetails(row) {
	emailDialogTitle.textContent = 'Email send details';
	emailDialogBody.replaceChildren();
	appendDetails(emailDialogBody, [
		['Sent', exactTime(row.created_at)], ['Recipient', row.user_label || `User ${row.user_id}`], ['Email', row.user_email],
		['Campaign', row.campaign], ['User ID', row.user_id], ['Send ID', row.id]
	]);
	const meta = document.createElement('section'); meta.className = 'admin-job-detail';
	const heading = document.createElement('h3'); heading.textContent = 'Details';
	const pre = document.createElement('pre'); pre.className = 'admin-job-detail__json'; pre.textContent = row.meta ? JSON.stringify(row.meta, null, 2) : '—';
	meta.append(heading, pre); emailDialogBody.append(meta); emailDialog.showModal();
}

loadAdminDataTable(document.querySelector('[data-email-sends]'), {
	fetchUrl: '/api/admin-tools/email-sends', itemsKey: 'items', pageSize: 25, defaultSortBy: 'created_at', defaultSortDir: 'desc',
	emptyMessage: 'No email sends yet.', ariaLabel: 'Email send history', onRowClick: showSendDetails,
	columns: [
		{ key: 'created_at', label: 'Sent', sortKey: 'created_at', className: 'admin-email-cell-date', render: (row) => dateCell(row.created_at) },
		{ key: 'user_label', label: 'Recipient', render: (row) => short(row.user_label || `User ${row.user_id}`, 36) },
		{ key: 'campaign', label: 'Campaign', sortKey: 'campaign', render: (row) => short(row.campaign, 36) }
	]
});

const runCronButton = document.querySelector('[data-run-notifications-cron]');
const runCronSpinner = document.querySelector('[data-run-notifications-spinner]');
const runCronLabel = document.querySelector('[data-run-notifications-label]');
const runCronStatus = document.querySelector('[data-run-notifications-status]');
runCronButton?.addEventListener('click', async () => {
	runCronButton.disabled = true;
	runCronButton.setAttribute('aria-busy', 'true');
	runCronSpinner.hidden = false;
	runCronLabel.textContent = 'Running…';
	runCronStatus.textContent = 'Running notifications cron…';
	runCronStatus.hidden = false;
	runCronStatus.classList.remove('admin-status--error');
	try {
		const response = await fetch('/api/admin-tools/run-notifications-cron', {
			method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}'
		});
		const result = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
		runCronStatus.textContent = result.message || 'Cron completed.';
	} catch (error) {
		runCronStatus.textContent = error.message || 'Unable to run cron.';
		runCronStatus.classList.add('admin-status--error');
	} finally {
		runCronButton.disabled = false;
		runCronButton.removeAttribute('aria-busy');
		runCronSpinner.hidden = true;
		runCronLabel.textContent = 'Run cron now';
	}
});

const settingDefinitions = [
	{ key: 'email_use_test_recipient', label: 'Send to test address', type: 'checkbox', description: "Route lifecycle and transactional emails to Resend's test address instead of real users." },
	{ key: 'email_dry_run', label: 'Dry run', type: 'checkbox', description: 'Scheduled digest sends are recorded without delivering email. Admin broadcasts also honor this setting.' },
	{ key: 'digest_utc_windows', label: 'Digest windows (UTC)', type: 'text', description: 'Comma-separated UTC times, such as 09:00,18:00.' },
	{ key: 'max_digests_per_user_per_day', label: 'Max digests per user per day', type: 'number', min: 0, description: 'Daily cap for digest messages.' },
	{ key: 'digest_activity_hours_lookback', label: 'Activity lookback (hours)', type: 'number', min: 1, description: 'Hours of unread activity considered when building digest candidates.' },
	{ key: 'welcome_email_delay_hours', label: 'Welcome email delay (hours)', type: 'number', min: 0, description: 'Delay after signup before a welcome email is eligible. Zero means immediate.' },
	{ key: 'reengagement_inactive_days', label: 'Re-engagement inactivity (days)', type: 'number', min: 1, description: 'Days inactive before a user is eligible for a re-engagement email.' },
	{ key: 'reengagement_cooldown_days', label: 'Re-engagement cooldown (days)', type: 'number', min: 1, description: 'Minimum days between re-engagement emails to one user.' },
	{ key: 'creation_highlight_lookback_hours', label: 'Creation highlight lookback (hours)', type: 'number', min: 1, description: 'Comment activity window for creation highlight emails.' },
	{ key: 'creation_highlight_cooldown_days', label: 'Creation highlight cooldown (days)', type: 'number', min: 1, description: 'Minimum days between highlight emails to one user.' },
	{ key: 'creation_highlight_min_comments', label: 'Minimum comments for highlight', type: 'number', min: 0, description: 'Minimum comments in the lookback window to qualify a creation.' }
];
let settings = {};
const settingsContainer = document.querySelector('[data-email-settings-table]');
const settingsStatus = document.querySelector('[data-email-settings-status]');
const settingDialog = document.querySelector('[data-email-setting-dialog]');
const settingForm = document.querySelector('[data-email-setting-form]');
const settingTitle = document.querySelector('[data-email-setting-title]');
const settingEditor = document.querySelector('[data-email-setting-editor]');
const settingStatus = document.querySelector('[data-email-setting-status]');
let selectedSetting = null;

function settingDisplay(definition) {
	const value = settings[definition.key];
	return definition.type === 'checkbox' ? (String(value) === 'true' || String(value) === '1' ? 'On' : 'Off') : String(value ?? '—');
}

function renderSettings() {
	settingsContainer.replaceChildren();
	const wrap = document.createElement('div'); wrap.className = 'admin-table-wrap';
	const table = document.createElement('table'); table.className = 'admin-table admin-email-settings-table'; table.setAttribute('aria-label', 'Email settings');
	const head = table.createTHead().insertRow();
	for (const label of ['Setting', 'Value']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; head.append(th); }
	const body = table.createTBody();
	for (const definition of settingDefinitions) {
		const row = body.insertRow(); row.className = 'admin-table__interactive-row'; row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', `Edit ${definition.label}`);
		const label = row.insertCell(); label.textContent = definition.label;
		const value = row.insertCell(); value.textContent = settingDisplay(definition); value.className = 'admin-email-settings-value';
		row.addEventListener('click', () => editSetting(definition));
		row.addEventListener('keydown', (event) => { if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); editSetting(definition); } });
	}
	wrap.append(table); settingsContainer.append(wrap);
}

function editSetting(definition) {
	selectedSetting = definition; settingTitle.textContent = definition.label; settingStatus.textContent = '';
	settingEditor.replaceChildren();
	const field = document.createElement('label'); field.className = 'admin-field';
	const caption = document.createElement('span'); caption.className = 'admin-field__label'; caption.textContent = definition.label;
	const input = document.createElement('input'); input.className = 'admin-input'; input.name = 'value'; input.type = definition.type;
	if (definition.type === 'checkbox') input.checked = String(settings[definition.key]) === 'true' || String(settings[definition.key]) === '1';
	else { input.value = settings[definition.key] ?? ''; if (definition.type === 'number') { input.min = String(definition.min); input.step = '1'; } }
	const help = document.createElement('p'); help.className = 'admin-field__help'; help.textContent = definition.description;
	if (definition.type === 'checkbox') {
		const row = document.createElement('span'); row.className = 'admin-field__checkbox-row'; row.append(input, caption); field.append(row, help);
	} else field.append(caption, input, help);
	settingEditor.append(field); settingDialog.showModal();
}

document.querySelector('[data-email-setting-close]')?.addEventListener('click', () => settingDialog?.close());
document.querySelector('[data-email-setting-cancel]')?.addEventListener('click', () => settingDialog?.close());
settingDialog?.addEventListener('click', (event) => { if (event.target === settingDialog) settingDialog.close(); });
settingForm.addEventListener('submit', async (event) => {
	event.preventDefault(); if (!selectedSetting) return;
	const input = settingForm.elements.value;
	const value = selectedSetting.type === 'checkbox' ? input.checked : input.value.trim();
	settingStatus.textContent = 'Saving…'; settingStatus.classList.remove('admin-status--error');
	try {
		const response = await fetch('/api/admin-tools/email-settings', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [selectedSetting.key]: value }) });
		const result = await response.json(); if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
		settings = result; renderSettings(); settingStatus.textContent = 'Saved.'; settingsStatus.textContent = 'Setting saved.'; settingDialog.close();
	} catch (error) { settingStatus.textContent = error.message; settingStatus.classList.add('admin-status--error'); }
});

async function loadSettings() {
	settingsStatus.textContent = 'Loading…';
	try {
		const response = await fetch('/api/admin-tools/email-settings', { credentials: 'same-origin' });
		const result = await response.json(); if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
		settings = result; renderSettings(); settingsStatus.textContent = '';
	} catch (error) { settingsStatus.textContent = error.message; settingsStatus.classList.add('admin-status--error'); }
}
void loadSettings();

async function loadTemplates() {
	const container = document.querySelector('[data-email-templates]');
	try {
		const response = await fetch('/api/admin-tools/email-templates', { credentials: 'same-origin' });
		const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load templates.');
		container.replaceChildren();
		for (const template of data.items || []) {
			const card = document.createElement('article'); card.className = 'admin-email-template';
			const heading = document.createElement('h2'); heading.textContent = template.label;
			const frame = document.createElement('iframe'); frame.title = `${template.label} email preview`; frame.loading = 'lazy'; frame.sandbox = ''; frame.src = `/api/admin-tools/email-templates/${encodeURIComponent(template.name)}`;
			card.append(heading, frame); container.append(card);
		}
	} catch (error) { container.replaceChildren(Object.assign(document.createElement('p'), { className: 'admin-status admin-status--error', textContent: error.message })); }
}
void loadTemplates();

const form = document.querySelector('[data-manual-email-form]');
const templateSelect = form.elements.template;
const recipientSelect = form.elements.recipient;
const singleSendMode = document.querySelector('[data-single-send-mode]');
const singleTemplateFields = document.querySelector('[data-single-template-fields]');
const templatePrompt = document.querySelector('[data-template-prompt]');
const templateHelp = document.querySelector('[data-template-help]');
const recipientFields = document.querySelector('[data-manual-recipient-fields]');
const recipientNameField = document.querySelector('[data-recipient-name-field]');
const feedbackFields = document.querySelector('[data-feature-feedback-fields]');
const broadcastFields = document.querySelector('[data-broadcast-fields]');
const broadcastAudience = document.querySelector('[data-broadcast-audience]');
const sendStatus = document.querySelector('[data-manual-email-status]');
const sendButton = document.querySelector('[data-send-email]');
const sendBroadcastButton = document.querySelector('[data-send-broadcast]');
const previewButton = document.querySelector('[data-preview-broadcast]');
const previewDialog = document.querySelector('[data-broadcast-preview-dialog]');
const previewFrame = document.querySelector('[data-broadcast-preview-frame]');
const previewClose = document.querySelector('[data-broadcast-preview-close]');
const recipientsById = new Map();
let audienceState = null;
let audienceTimer;

const broadcastValues = () => ({
	emailSubject: form.elements.emailSubject.value.trim(), headline: form.elements.headline.value.trim(),
	message: form.elements.broadcastMessage.value.trim(), ctaText: form.elements.ctaText.value.trim(), ctaUrl: form.elements.ctaUrl.value.trim()
});

function updateManualFields() {
	const template = templateSelect.value;
	const isBroadcast = template === 'adminBroadcast';
	const hasTemplate = !isBroadcast && Boolean(template);
	const isFeedback = hasTemplate && template === 'featureRequestFeedback';
	const templateOption = templateSelect.selectedOptions[0];
	singleSendMode.hidden = !hasTemplate;
	singleTemplateFields.hidden = !hasTemplate;
	templatePrompt.hidden = hasTemplate || isBroadcast;
	templateHelp.textContent = isFeedback
		? 'This template includes a feature request and reply. Review or edit both before sending.'
		: 'This sends a sample of the selected template. Its example content is fixed; only the recipient can be changed.';
	templateSelect.required = true;
	recipientSelect.required = hasTemplate;
	const manual = recipientSelect.value === 'manual';
	recipientFields.hidden = !hasTemplate || !manual;
	recipientNameField.hidden = !isFeedback || !manual;
	form.elements.to.required = hasTemplate && manual;
	feedbackFields.hidden = !isFeedback; form.elements.message.required = isFeedback;
	broadcastFields.hidden = !isBroadcast;
	for (const input of broadcastFields.querySelectorAll('input,textarea')) input.required = isBroadcast && input.name !== 'headline';
	sendButton.hidden = !hasTemplate;
	sendButton.textContent = `Send ${templateOption?.textContent || 'email'}`;
	void refreshAudience();
}

async function loadManualData() {
	try {
		const [templatesResponse, recipientsResponse] = await Promise.all([
			fetch('/api/admin-tools/email-templates', { credentials: 'same-origin' }),
			fetch('/api/admin-tools/email-recipients', { credentials: 'same-origin' })
		]);
		const templatesData = await templatesResponse.json(); const recipientsData = await recipientsResponse.json();
		if (!templatesResponse.ok) throw new Error(templatesData.error || 'Could not load email templates.');
		if (!recipientsResponse.ok) throw new Error(recipientsData.error || 'Could not load recipients.');
		for (const template of templatesData.items || []) {
			const option = document.createElement('option'); option.value = template.name; option.textContent = template.label; templateSelect.append(option);
		}
		for (const user of recipientsData.items || []) {
			recipientsById.set(String(user.id), user);
			const option = document.createElement('option'); option.value = String(user.id); option.textContent = `${user.label} · ${user.email}`;
			recipientSelect.append(option);
		}
	} catch (error) { sendStatus.textContent = error.message; sendStatus.classList.add('admin-status--error'); }
}

async function refreshAudience() {
	if (templateSelect.value !== 'adminBroadcast') { broadcastAudience.textContent = ''; audienceState = null; return; }
	broadcastAudience.textContent = 'Loading recipient count…';
	try {
		const response = await fetch(`/api/admin-tools/broadcast-audience?subject=${encodeURIComponent(form.elements.emailSubject.value.trim())}`, { credentials: 'same-origin' });
		const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load recipient count.');
		audienceState = data;
		const parts = [`${data.remainingCount} eligible recipients remain; ${data.alreadySentCount} already received this subject.`];
		if (data.dryRun) parts.push('Dry run is on; no email will be delivered.');
		else if (data.emailUseTestRecipient) parts.push('Test recipient mode is on; mail goes to Resend’s test address.');
		broadcastAudience.textContent = parts.join(' ');
	} catch (error) { audienceState = null; broadcastAudience.textContent = error.message; }
}

templateSelect.addEventListener('change', updateManualFields);
recipientSelect.addEventListener('change', updateManualFields);
form.elements.emailSubject.addEventListener('input', () => { clearTimeout(audienceTimer); audienceTimer = setTimeout(refreshAudience, 250); });
form.elements.emailSubject.addEventListener('change', refreshAudience);
sendButton.addEventListener('click', () => form.requestSubmit());
sendBroadcastButton.addEventListener('click', () => form.requestSubmit());
updateManualFields();
void loadManualData();

previewButton.addEventListener('click', async () => {
	const values = broadcastValues();
	if (!values.emailSubject || !values.message || !values.ctaText || !/^https?:\/\//i.test(values.ctaUrl)) { sendStatus.textContent = 'Enter subject, message, button label, and an HTTP(S) button URL to preview.'; sendStatus.classList.add('admin-status--error'); return; }
	previewButton.disabled = true; previewButton.textContent = 'Loading…'; sendStatus.textContent = '';
	try {
		const response = await fetch('/api/admin-tools/email-templates/adminBroadcast/preview', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
		const contentType = response.headers.get('content-type') || '';
		if (!response.ok) { const error = contentType.includes('json') ? (await response.json()).error : 'Could not render preview.'; throw new Error(error); }
		previewFrame.srcdoc = await response.text(); previewDialog.showModal();
	} catch (error) { sendStatus.textContent = error.message; sendStatus.classList.add('admin-status--error'); }
	finally { previewButton.disabled = false; previewButton.textContent = 'Preview email'; }
});
previewClose.addEventListener('click', () => previewDialog.close());
previewDialog.addEventListener('click', (event) => { if (event.target === previewDialog) previewDialog.close(); });

form.addEventListener('submit', async (event) => {
	event.preventDefault(); sendStatus.textContent = ''; sendStatus.classList.remove('admin-status--error');
	const template = templateSelect.value;
	const isBroadcast = template === 'adminBroadcast';
	if (isBroadcast) {
		const values = broadcastValues();
		if (!values.emailSubject || !values.message || !values.ctaText || !/^https?:\/\//i.test(values.ctaUrl)) { sendStatus.textContent = 'Complete the broadcast subject, message, button label, and HTTP(S) URL.'; sendStatus.classList.add('admin-status--error'); return; }
		if (!audienceState || audienceState.eligibleCount < 1) { sendStatus.textContent = 'No eligible recipients. Reload recipient counts and check account eligibility.'; sendStatus.classList.add('admin-status--error'); return; }
		if (audienceState.remainingCount === 0) { sendStatus.textContent = `Everyone eligible already received this subject (${audienceState.alreadySentCount}).`; return; }
		const confirmed = window.confirm(`Send this broadcast to ${audienceState.remainingCount} eligible consumer${audienceState.remainingCount === 1 ? '' : 's'}? ${audienceState.alreadySentCount} already received this subject and will be skipped.${audienceState.dryRun ? ' Dry run is enabled, so no email will be delivered.' : ''}`);
		if (!confirmed) return;
		sendBroadcastButton.disabled = true; sendStatus.textContent = 'Sending broadcast…';
		try {
			const response = await fetch('/api/admin-tools/send-broadcast', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
			const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Broadcast failed.');
			if (data.dryRun) sendStatus.textContent = `Dry run: ${data.eligible} recipients would receive this broadcast.`;
			else if (data.failed) sendStatus.textContent = `Broadcast finished: ${data.sent} sent, ${data.failed} failed. ${data.errors?.map((item) => item.userName || item.email).join(', ') || ''}`;
			else sendStatus.textContent = `Broadcast sent to ${data.sent}. ${data.alreadySent} previously sent and skipped.`;
			void refreshAudience();
		} catch (error) { sendStatus.textContent = error.message; sendStatus.classList.add('admin-status--error'); }
		finally { sendBroadcastButton.disabled = false; }
		return;
	}
	const selected = recipientSelect.value;
	const user = recipientsById.get(selected);
	const to = selected === 'manual' ? form.elements.to.value.trim() : user?.email;
	if (!to) { sendStatus.textContent = 'Choose a recipient or enter a valid email address.'; sendStatus.classList.add('admin-status--error'); return; }
	const body = { to, template };
	if (template === 'featureRequestFeedback') {
		body.recipientName = selected === 'manual' ? form.elements.recipientName.value.trim() : (user?.user_name ? `@${user.user_name}` : user?.display_name || 'there');
		body.originalRequest = form.elements.originalRequest.value.trim(); body.message = form.elements.message.value.trim();
	}
	sendButton.disabled = true; sendStatus.textContent = 'Sending…';
	try {
		const response = await fetch('/api/admin-tools/send-test-email', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
		const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Email send failed.');
		sendStatus.textContent = 'Email sent.';
	} catch (error) { sendStatus.textContent = error.message; sendStatus.classList.add('admin-status--error'); }
	finally { sendButton.disabled = false; }
});
