import { loadAdminDataTable } from '/admin/shared/adminDataTable.js';

const activeUsers = document.querySelector('[data-active-users]');
const otherUsers = document.querySelector('[data-other-users]');
const tipsTable = document.querySelector('[data-tips-table]');
const settingsForm = document.querySelector('[data-users-settings]');
const settingsStatus = document.querySelector('[data-settings-status]');
const settingsTableStatus = document.querySelector('[data-settings-table-status]');
const settingsValue = document.querySelector('[data-tip-setting-value]');
const settingsRow = document.querySelector('[data-tip-setting-row]');
const settingsDialog = document.querySelector('[data-settings-dialog]');
const settingsSave = document.querySelector('[data-settings-save]');
const userDialog = document.querySelector('[data-user-dialog]');
const actionDialog = document.querySelector('[data-user-action-dialog]');
const tipDialog = document.querySelector('[data-tip-dialog]');
const actionForm = document.querySelector('[data-user-action-form]');
const actionFields = document.querySelector('[data-action-fields]');
const actionError = document.querySelector('[data-action-error]');
const actionSubmit = document.querySelector('[data-action-submit]');
const userTables = [];
let currentUser = null;
let viewerId = null;
let exportInFlight = false;

async function request(url, options) {
	const response = await fetch(url, { credentials: 'same-origin', ...options });
	const body = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(body.message || body.error || `Request failed (${response.status})`);
	return body;
}

function renderUserDetails(user) {
	const details = userDialog.querySelector('[data-user-details]');
	const userProfile = user.profile || {};
	const fields = [
		['Username', userProfile.user_name || user.user_name || '—'],
		['Email', user.email || '—'],
		['User ID', user.id],
		['Credits', Number(user.credits || 0).toFixed(1)],
		['Unread notifications', user.unreadNotifications ?? '—'],
		['Client IDs', Array.isArray(user.meta?.prsn_cids) && user.meta.prsn_cids.length ? user.meta.prsn_cids.join(', ') : '—'],
		['Stripe subscription', user.meta?.stripeSubscriptionId || '—']
	];
	details.replaceChildren();
	for (const [label, value] of fields) {
		const term = document.createElement('dt');
		term.textContent = label;
		const description = document.createElement('dd');
		description.textContent = String(value);
		details.append(term, description);
	}
	const title = userDialog.querySelector('#admin-user-title');
	title.textContent = userProfile.user_name || user.user_name || user.email || `User ${user.id}`;
	const suspended = user.suspended === true || user.meta?.suspended === true;
	userDialog.querySelector('[data-user-tip]').hidden = false;
	const suspendButton = userDialog.querySelector('[data-user-suspend]');
	suspendButton.textContent = suspended ? 'Unsuspend' : 'Suspend';
	suspendButton.hidden = Number(user.id) === viewerId;
	userDialog.querySelector('[data-user-delete]').hidden = Number(user.id) === viewerId;
	const founderButton = userDialog.querySelector('[data-user-founder]');
	const giftedFounder = user.meta?.plan === 'founder' && user.meta?.stripeSubscriptionId === 'gifted_founder';
	const paidFounder = user.meta?.plan === 'founder' && user.meta?.stripeSubscriptionId && !giftedFounder;
	founderButton.hidden = Boolean(paidFounder);
	founderButton.textContent = giftedFounder ? 'Revoke gifted founder' : 'Grant founder status (gifted)';
	founderButton.dataset.action = giftedFounder ? 'revoke-founder' : 'grant-founder';
	const username = userProfile.user_name || user.user_name;
	const profileLink = userDialog.querySelector('[data-user-profile]');
	profileLink.href = username ? `/p/${encodeURIComponent(username)}` : `/user/${encodeURIComponent(user.id)}`;
	profileLink.hidden = false;
	userDialog.querySelector('[data-user-status]').textContent = '';
}

function renderBlankUserDetails() {
	const details = userDialog.querySelector('[data-user-details]');
	const labels = ['Username', 'Email', 'User ID', 'Credits', 'Unread notifications', 'Client IDs', 'Stripe subscription'];
	details.replaceChildren();
	for (const label of labels) {
		const term = document.createElement('dt');
		term.textContent = label;
		const value = document.createElement('dd');
		value.textContent = '';
		details.append(term, value);
	}
	userDialog.querySelector('#admin-user-title').textContent = 'User';
	userDialog.querySelector('[data-user-status]').textContent = '';
	userDialog.querySelector('[data-user-profile]').removeAttribute('href');
	for (const button of userDialog.querySelectorAll('.admin-user-actions button, .admin-user-actions a')) button.hidden = true;
}

async function openUser(row) {
	currentUser = row;
	if (!userDialog.open) userDialog.showModal();
	renderBlankUserDetails();
	try {
		currentUser = await request(`/api/admin/users/${encodeURIComponent(row.id)}`);
		renderUserDetails(currentUser);
	} catch (error) {
		userDialog.querySelector('[data-user-status]').textContent = error.message;
	}
}

function openActionDialog(action) {
	if (!currentUser) return;
	const title = actionDialog.querySelector('#admin-user-action-title');
	const description = actionDialog.querySelector('[data-action-description]');
	const email = String(currentUser.email || '');
	actionDialog.dataset.action = action;
	actionError.hidden = true;
	actionError.textContent = '';
	actionFields.replaceChildren();
	const requiresEmail = action === 'suspend' || action === 'delete';
	if (action === 'tip') {
		title.textContent = 'Tip credits';
		description.textContent = `Send credits to ${email || `user ${currentUser.id}`}.`;
		const amount = document.createElement('input');
		amount.className = 'admin-input';
		amount.name = 'amount';
		amount.type = 'number';
		amount.min = '0.1';
		amount.step = '0.1';
		amount.required = true;
		amount.placeholder = 'Amount';
		const message = document.createElement('textarea');
		message.className = 'admin-input';
		message.name = 'message';
		message.maxLength = 500;
		message.placeholder = 'Message (optional)';
		actionFields.append(amount, message);
	} else if (action === 'suspend') {
		const suspended = currentUser.suspended === true || currentUser.meta?.suspended === true;
		title.textContent = suspended ? 'Unsuspend user' : 'Suspend user';
		description.textContent = `${suspended ? 'This restores access for' : 'This blocks access for'} ${email}. Type the email to confirm.`;
	} else if (action === 'delete') {
		title.textContent = 'Delete user';
		description.textContent = `This permanently deletes ${email} and their associated content. Type the email to confirm.`;
		actionSubmit.classList.add('admin-button--danger');
	} else {
		title.textContent = action === 'grant-founder' ? 'Grant founder status' : 'Revoke gifted founder status';
		description.textContent = action === 'grant-founder'
			? `Grant gifted founder status to ${email || `user ${currentUser.id}`}?`
			: `Remove gifted founder status from ${email || `user ${currentUser.id}`}?`;
	}
	if (requiresEmail) {
		const input = document.createElement('input');
		input.className = 'admin-input';
		input.name = 'confirmation';
		input.autocomplete = 'off';
		input.required = true;
		input.placeholder = email;
		input.addEventListener('input', () => { actionSubmit.disabled = input.value.trim().toLowerCase() !== email.trim().toLowerCase(); });
		actionFields.append(input);
		actionSubmit.disabled = true;
	} else {
		actionSubmit.disabled = false;
	}
	if (action !== 'delete') actionSubmit.classList.remove('admin-button--danger');
	actionSubmit.textContent = action === 'tip' ? 'Send tip' : action === 'delete' ? 'Delete user' : 'Confirm';
	actionDialog.showModal();
}

function resetUserDialog() {
	if (userDialog.open) return;
	currentUser = null;
	renderBlankUserDetails();
}

function resetActionDialog() {
	if (actionDialog.open) return;
	actionForm.reset();
	actionDialog.dataset.action = '';
	actionDialog.querySelector('#admin-user-action-title').textContent = '';
	actionDialog.querySelector('[data-action-description]').textContent = '';
	actionFields.replaceChildren();
	actionError.textContent = '';
	actionError.hidden = true;
	actionSubmit.disabled = false;
	actionSubmit.classList.remove('admin-button--danger');
	actionSubmit.textContent = 'Confirm';
}

async function refreshUserTables() {
	for (const table of userTables) await table.refresh();
}

async function copyActiveUsers() {
	if (exportInFlight) return;
	exportInFlight = true;
	const button = document.querySelector('[data-active-export-copy]');
	const status = document.querySelector('[data-active-export-status]');
	button.disabled = true;
	status.textContent = 'Preparing active users export…';
	try {
		const activeUsers = [];
		const limit = 200;
		for (let offset = 0; ; offset += limit) {
			const page = await request(`/api/admin/users?segment=active&limit=${limit}&offset=${offset}`);
			activeUsers.push(...(Array.isArray(page.items) ? page.items : []));
			if (activeUsers.length >= Number(page.total || 0) || !page.items?.length) break;
		}
		const payload = {
			export_version: 1,
			exported_at: new Date().toISOString(),
			scope: '/users#active',
			item_count: activeUsers.length,
			data: { activeUsers }
		};
		const text = `PARASCENE_ADMIN_EXPORT\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const textarea = document.createElement('textarea');
			textarea.value = text;
			textarea.setAttribute('readonly', 'true');
			textarea.style.position = 'fixed';
			textarea.style.left = '-9999px';
			document.body.append(textarea);
			textarea.select();
			const copied = document.execCommand('copy');
			textarea.remove();
			if (!copied) throw new Error('Copy to clipboard failed.');
		}
		window.__parasceneAdminChatGPTExport = text;
		status.textContent = `Copied ${activeUsers.length} active users to clipboard.`;
	} catch (error) {
		status.textContent = `Export failed: ${error.message}`;
	} finally {
		button.disabled = false;
		exportInFlight = false;
	}
}

async function runUserAction(event) {
	event.preventDefault();
	if (!currentUser) return;
	const action = actionDialog.dataset.action;
	const id = currentUser.id;
	actionSubmit.disabled = true;
	actionError.hidden = true;
	try {
		if (action === 'tip') {
			await request('/api/credits/tip', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ toUserId: Number(id), amount: Number(actionForm.elements.amount.value), message: actionForm.elements.message.value.trim() || undefined })
			});
		} else if (action === 'suspend') {
			await request(`/api/admin/users/${id}`, {
				method: 'PUT', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ suspended: !(currentUser.suspended === true || currentUser.meta?.suspended === true) })
			});
		} else if (action === 'grant-founder' || action === 'revoke-founder') {
			await request(`/api/admin/users/${id}/${action}`, { method: 'POST' });
		} else if (action === 'delete') {
			await request(`/api/admin/users/${id}`, {
				method: 'DELETE', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ confirmation_email: actionForm.elements.confirmation.value })
			});
			actionDialog.close();
			userDialog.close();
			currentUser = null;
			await refreshUserTables();
			return;
		}
		actionDialog.close();
		await refreshUserTables();
		await openUser({ id });
	} catch (error) {
		actionError.textContent = error.message;
		actionError.hidden = false;
	} finally {
		actionSubmit.disabled = false;
	}
}

function usernameCell(user) {
	const wrap = document.createElement('span');
	wrap.className = 'admin-user-identity';
	if (user.avatar_url) {
		const avatar = document.createElement('img');
		avatar.className = 'admin-user-identity__avatar';
		avatar.src = user.avatar_url;
		avatar.alt = '';
		avatar.loading = 'lazy';
		avatar.decoding = 'async';
		wrap.append(avatar);
	}
	const username = document.createElement('span');
	username.textContent = user.user_name || '—';
	wrap.append(username);
	return wrap;
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function relativeDateCell(timestamp) {
	if (!timestamp) return '—';
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return '—';
	const elapsedSeconds = (date.getTime() - Date.now()) / 1000;
	const units = [
		['year', 60 * 60 * 24 * 365], ['month', 60 * 60 * 24 * 30],
		['week', 60 * 60 * 24 * 7], ['day', 60 * 60 * 24],
		['hour', 60 * 60], ['minute', 60]
	];
	const [unit, seconds] = units.find(([, threshold]) => Math.abs(elapsedSeconds) >= threshold) || ['second', 1];
	const text = unit === 'second' && Math.abs(elapsedSeconds) < 10
		? 'just now'
		: relativeTime.format(Math.round(elapsedSeconds / seconds), unit);
	const label = document.createElement('time');
	label.dateTime = date.toISOString();
	label.title = date.toLocaleString();
	label.textContent = text;
	return label;
}
function lastActiveCell(user) {
	return relativeDateCell(user.last_active_at);
}

const otherUserColumns = [
	{ key: 'user_name', label: 'Username', render: usernameCell },
	{ key: 'last_active_at', label: 'Last active', sortKey: 'last_active_at', render: lastActiveCell },
	{ key: 'credits', label: 'Credits', render: (user) => Number(user.credits || 0).toFixed(1) },
	{ key: 'status', label: 'Status', render: (user) => user.suspended ? 'Suspended' : (user.meta?.plan === 'founder' ? 'Founder' : 'Active') }
];
const activeUserColumns = [
	{ key: 'user_name', label: 'Username', render: usernameCell },
	{ key: 'last_active_at', label: 'Last active', sortKey: 'last_active_at', render: lastActiveCell },
	{ key: 'credits', label: 'Credits', render: (user) => Number(user.credits || 0).toFixed(1) },
	{ key: 'created_at', label: 'Joined', sortKey: 'created_at', render: (user) => relativeDateCell(user.created_at) }
];

try {
	const viewer = await request('/api/profile');
	viewerId = Number(viewer.id) || null;
} catch { /* Protected admin pages already gate the signed-in role. */ }

for (const [container, segment] of [[activeUsers, 'active'], [otherUsers, 'other']]) {
	const table = await loadAdminDataTable(container, {
		fetchUrl: '/api/admin/users',
		itemsKey: 'items',
		ariaLabel: `${segment === 'active' ? 'Active' : 'Other'} users`,
		columns: segment === 'active' ? activeUserColumns : otherUserColumns,
		pageSize: 25,
		defaultSortBy: 'last_active_at',
		defaultSortDir: 'desc',
		emptyMessage: segment === 'active' ? 'No active users.' : 'No other users.',
		rowLabel: 'user details',
		getRowLabel: (user) => `Open ${user.user_name || `user ${user.id}`}`,
		onRowClick: openUser,
		getExtraParams: () => ({ segment })
	});
	userTables.push(table);
}

userDialog.querySelector('[data-user-close]').addEventListener('click', () => userDialog.close());
userDialog.addEventListener('click', (event) => { if (event.target === userDialog) userDialog.close(); });
userDialog.addEventListener('close', resetUserDialog);
userDialog.querySelector('[data-user-tip]').addEventListener('click', () => openActionDialog('tip'));
userDialog.querySelector('[data-user-suspend]').addEventListener('click', () => openActionDialog('suspend'));
userDialog.querySelector('[data-user-delete]').addEventListener('click', () => openActionDialog('delete'));
userDialog.querySelector('[data-user-founder]').addEventListener('click', (event) => openActionDialog(event.currentTarget.dataset.action));
actionDialog.querySelector('[data-action-close]').addEventListener('click', () => actionDialog.close());
actionDialog.querySelector('[data-action-cancel]').addEventListener('click', () => actionDialog.close());
actionDialog.addEventListener('click', (event) => { if (event.target === actionDialog) actionDialog.close(); });
actionDialog.addEventListener('close', resetActionDialog);
actionForm.addEventListener('submit', runUserAction);

void loadAdminDataTable(tipsTable, {
	fetchUrl: '/api/admin/tips',
	itemsKey: 'items',
	ariaLabel: 'Tips',
	rowLabel: 'tip details',
	getRowLabel: (row) => `View ${tipKindLabel(row)} from ${row.from_user_name || row.from_label || row.from_user_id} to ${row.to_user_name || row.to_label || row.to_user_id}`,
	onRowClick: openTipDetails,
	columns: [
		{ key: 'created_at', label: 'Date', sortKey: 'created_at', render: (row) => relativeDateCell(row.created_at) },
		{ key: 'from_user_name', label: 'From', render: tipFromCell },
		{ key: 'to_user_name', label: 'To', render: (row) => row.to_user_name ? `@${row.to_user_name}` : `#${row.to_user_id}` },
		{ key: 'amount', label: 'Amount (credits)', render: (row) => Number(row.amount || 0).toFixed(1) }
	],
	pageSize: 25,
	defaultSortBy: 'created_at',
	defaultSortDir: 'desc',
	emptyMessage: 'No tips yet.'
});

function appendTipDetail(details, label, content) {
	const term = document.createElement('dt');
	term.textContent = label;
	const value = document.createElement('dd');
	if (content instanceof Node) value.append(content);
	else value.textContent = content == null || content === '' ? '—' : String(content);
	details.append(term, value);
}

function tipKindLabel(row) {
	return row.tip_kind === 'challenge_prize' ? 'Challenge prize' : 'User tip';
}

function tipFromCell(row) {
	if (row.tip_kind === 'challenge_prize') {
		const marker = document.createElement('span');
		marker.className = 'admin-tip-challenge-marker';
		marker.textContent = '[challenge]';
		return marker;
	}
	return row.from_user_name ? `@${row.from_user_name}` : `#${row.from_user_id}`;
}

function tipProfileLink(username, id) {
	const link = document.createElement('a');
	link.href = `/user/${encodeURIComponent(id)}`;
	link.textContent = username ? `@${username}` : `#${id}`;
	link.target = '_blank';
	link.rel = 'noopener';
	return link;
}

function openTipDetails(row) {
	const details = tipDialog.querySelector('[data-tip-details]');
	details.replaceChildren();
	appendTipDetail(details, 'Tip ID', row.id);
	appendTipDetail(details, 'Type', tipKindLabel(row));
	appendTipDetail(details, 'Date', row.created_at ? new Date(row.created_at).toLocaleString() : '—');
	appendTipDetail(details, 'From', row.from_user_id ? tipProfileLink(row.from_user_name, row.from_user_id) : row.from_label);
	appendTipDetail(details, 'To', row.to_user_id ? tipProfileLink(row.to_user_name, row.to_user_id) : row.to_label);
	if (row.tip_kind === 'challenge_prize') {
		appendTipDetail(details, 'Challenge', row.meta?.challenge_id || '—');
		appendTipDetail(details, 'Prize reason', row.meta?.reason || '—');
	}
	appendTipDetail(details, 'Amount (credits)', Number(row.amount || 0).toFixed(1));
	appendTipDetail(details, 'Creation', row.created_image_id ? creationLink(row.created_image_id) : '—');
	appendTipDetail(details, 'Message', typeof row.message === 'string' ? row.message.trim() || '—' : '—');
	tipDialog.showModal();
}

tipDialog.querySelector('[data-tip-close]').addEventListener('click', () => tipDialog.close());
tipDialog.addEventListener('click', (event) => { if (event.target === tipDialog) tipDialog.close(); });

function creationLink(id) {
	if (!id) return '—';
	const link = document.createElement('a');
	link.href = `/creations/${encodeURIComponent(id)}`;
	link.textContent = String(id);
	return link;
}

document.querySelector('[data-active-export-copy]').addEventListener('click', copyActiveUsers);

async function loadSettings() {
	try {
		const settings = await request('/api/admin/users/settings');
		settingsForm.elements.min_days_before_tip.value = settings.min_days_before_tip ?? 60;
		settingsValue.textContent = String(settings.min_days_before_tip ?? 60);
		settingsTableStatus.textContent = '';
	} catch (error) {
		settingsStatus.textContent = error.message;
		settingsTableStatus.textContent = error.message;
	}
}

function openSettingsDialog() {
	settingsStatus.textContent = '';
	settingsDialog.showModal();
}

settingsRow.addEventListener('click', openSettingsDialog);
settingsRow.addEventListener('keydown', (event) => {
	if (event.key !== 'Enter' && event.key !== ' ') return;
	event.preventDefault();
	openSettingsDialog();
});
settingsDialog.querySelector('[data-settings-close]').addEventListener('click', () => settingsDialog.close());
settingsDialog.querySelector('[data-settings-cancel]').addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('click', (event) => { if (event.target === settingsDialog) settingsDialog.close(); });

settingsForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	settingsStatus.textContent = 'Saving…';
	settingsSave.disabled = true;
	try {
		const result = await request('/api/admin/users/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ min_days_before_tip: Number(settingsForm.elements.min_days_before_tip.value) })
		});
		settingsForm.elements.min_days_before_tip.value = result.min_days_before_tip;
		settingsValue.textContent = String(result.min_days_before_tip);
		settingsStatus.textContent = 'Settings saved.';
	} catch (error) {
		settingsStatus.textContent = error.message;
	} finally {
		settingsSave.disabled = false;
	}
});

void loadSettings();
