import { loadAdminDataTable } from '/admin/shared/adminDataTable.js';

const activeUsers = document.querySelector('[data-active-users]');
const otherUsers = document.querySelector('[data-other-users]');
const tipsTable = document.querySelector('[data-tips-table]');
const settingsForm = document.querySelector('[data-users-settings]');
const settingsStatus = document.querySelector('[data-settings-status]');
const userDialog = document.querySelector('[data-user-dialog]');
const actionDialog = document.querySelector('[data-user-action-dialog]');
const actionForm = document.querySelector('[data-user-action-form]');
const actionFields = document.querySelector('[data-action-fields]');
const actionError = document.querySelector('[data-action-error]');
const actionSubmit = document.querySelector('[data-action-submit]');
const userTables = [];
let currentUser = null;
let viewerId = null;

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

const userColumns = [
	{ key: 'user_name', label: 'Username', render: (user) => user.user_name || '—' },
	{ key: 'last_active_at', label: 'Last active', sortKey: 'last_active_at', render: (user) => user.last_active_at ? new Date(user.last_active_at).toLocaleString() : '—' },
	{ key: 'credits', label: 'Credits', render: (user) => Number(user.credits || 0).toFixed(1) },
	{ key: 'status', label: 'Status', render: (user) => user.suspended ? 'Suspended' : (user.meta?.plan === 'founder' ? 'Founder' : 'Active') }
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
		columns: userColumns,
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
	columns: [
		{ key: 'created_at', label: 'Date', sortKey: 'created_at', render: (row) => row.created_at ? new Date(row.created_at).toLocaleString() : '—' },
		{ key: 'from_label', label: 'From' },
		{ key: 'to_label', label: 'To' },
		{ key: 'amount', label: 'Amount', render: (row) => `${Number(row.amount || 0).toFixed(1)} credits` },
		{ key: 'created_image_id', label: 'Creation' },
		{ key: 'message', label: 'Message' }
	],
	pageSize: 25,
	defaultSortBy: 'created_at',
	defaultSortDir: 'desc',
	emptyMessage: 'No tips yet.'
});

async function loadSettings() {
	try {
		const settings = await request('/api/admin/users/settings');
		settingsForm.elements.min_days_before_tip.value = settings.min_days_before_tip ?? 60;
	} catch (error) {
		settingsStatus.textContent = error.message;
	}
}

settingsForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	settingsStatus.textContent = 'Saving…';
	try {
		const result = await request('/api/admin/users/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ min_days_before_tip: Number(settingsForm.elements.min_days_before_tip.value) })
		});
		settingsForm.elements.min_days_before_tip.value = result.min_days_before_tip;
		settingsStatus.textContent = 'Settings saved.';
	} catch (error) {
		settingsStatus.textContent = error.message;
	}
});

void loadSettings();
