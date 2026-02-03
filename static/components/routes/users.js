import { getAvatarColor } from '../../shared/avatar.js';
import { formatRelativeTime } from '../../shared/datetime.js';

const html = String.raw;

function getUserDisplayName(user) {
	const displayName = String(user?.display_name || '').trim();
	if (displayName) return displayName;
	const userName = String(user?.user_name || '').trim();
	if (userName) return userName;
	const email = String(user?.email || '').trim();
	if (email) return email.split('@')[0] || email;
	if (user?.id) return `User ${user.id}`;
	return 'User';
}

function getUserInitial(displayName) {
	return String(displayName || '').trim().charAt(0).toUpperCase() || '?';
}

function createUserAvatar(user, getAvatarColorFn) {
	const displayName = getUserDisplayName(user);
	const avatarUrl = typeof user?.avatar_url === 'string' ? user.avatar_url.trim() : '';
	const avatar = document.createElement('div');
	avatar.className = 'user-avatar';
	if (avatarUrl) {
		const img = document.createElement('img');
		img.src = avatarUrl;
		img.alt = displayName ? `Avatar for ${displayName}` : 'User avatar';
		img.loading = 'lazy';
		img.decoding = 'async';
		avatar.appendChild(img);
	} else {
		const fallback = document.createElement('div');
		fallback.className = 'user-avatar-fallback';
		fallback.textContent = getUserInitial(displayName);
		fallback.style.background = getAvatarColorFn(user?.user_name || user?.email || user?.id);
		fallback.setAttribute('aria-hidden', 'true');
		avatar.appendChild(fallback);
	}
	return { avatar, displayName };
}

function renderUserCard(user, onOpenModal) {
	const card = document.createElement('div');
	card.className = 'card user-card';
	card.dataset.userId = String(user.id);
	card.tabIndex = 0;
	card.setAttribute('role', 'button');
	const { avatar, displayName } = createUserAvatar(user, getAvatarColor);
	card.setAttribute('aria-label', `Open user ${displayName}`);
	card.addEventListener('click', () => onOpenModal(user));
	card.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onOpenModal(user);
		}
	});

	const header = document.createElement('div');
	header.className = 'user-card-header';
	const info = document.createElement('div');
	info.className = 'user-card-info';
	const title = document.createElement('div');
	title.className = 'user-title';
	const nameRow = document.createElement('div');
	nameRow.className = 'user-name-row';
	const nameEl = document.createElement('div');
	nameEl.className = 'user-name';
	nameEl.textContent = displayName;
	nameRow.appendChild(nameEl);
	if (user.suspended) {
		const suspendedBadge = document.createElement('span');
		suspendedBadge.className = 'server-badge server-badge-suspended';
		suspendedBadge.textContent = 'Suspended';
		nameRow.appendChild(suspendedBadge);
	}
	title.appendChild(nameRow);
	if (user.email && user.email !== displayName) {
		const emailEl = document.createElement('div');
		emailEl.className = 'user-email';
		emailEl.textContent = user.email;
		title.appendChild(emailEl);
	}
	const details = document.createElement('div');
	details.className = 'user-meta';
	const userId = document.createElement('span');
	userId.className = 'user-id';
	userId.textContent = `#${user.id}`;
	const role = document.createElement('span');
	role.className = 'user-role';
	role.textContent = user.role;
	const credits = document.createElement('span');
	credits.className = 'user-credits';
	const creditsValue = typeof user.credits === 'number' ? user.credits : 0;
	credits.textContent = `${creditsValue.toFixed(1)} credits`;
	details.appendChild(userId);
	details.appendChild(role);
	details.appendChild(credits);
	info.appendChild(title);
	info.appendChild(details);
	header.appendChild(avatar);
	header.appendChild(info);

	const createdLabel = formatRelativeTime(user.created_at, { style: 'long' });
	const created = document.createElement('div');
	created.className = 'user-created';
	created.textContent = createdLabel ? `Joined ${createdLabel}` : (user.created_at || '—');

	const lastActiveLabel = user.last_active_at
		? formatRelativeTime(user.last_active_at, { style: 'long' })
		: null;
	const lastActive = document.createElement('div');
	lastActive.className = 'user-last-active';
	lastActive.textContent = lastActiveLabel ? `Last active ${lastActiveLabel}` : 'Last active —';

	card.appendChild(header);
	card.appendChild(created);
	card.appendChild(lastActive);
	return card;
}

class AppRouteUsers extends HTMLElement {
	connectedCallback() {
		this._activeTabId = 'active';
		this.innerHTML = html`
			<h3>Users</h3>
			<app-tabs>
				<tab data-id="active" label="Active" default>
					<div class="users-cards" data-users-active-container>
						<div class="route-empty route-loading">
							<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
						</div>
					</div>
				</tab>
				<tab data-id="other" label="Other">
					<div class="users-cards" data-users-other-container>
						<div class="route-empty route-loading">
							<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
						</div>
					</div>
				</tab>
			</app-tabs>
		`;
		this._tabsEl = this.querySelector('app-tabs');
		this._tabsEl?.addEventListener('tab-change', (e) => {
			if (e.detail?.id) this._activeTabId = e.detail.id;
		});
		this.loadUsers();
		this._boundRefresh = () => this.loadUsers({ force: true });
		document.addEventListener('user-updated', this._boundRefresh);
	}

	disconnectedCallback() {
		document.removeEventListener('user-updated', this._boundRefresh);
	}

	openUserModal(user) {
		const modal = document.querySelector('app-modal-user');
		if (modal) modal.open(user);
	}

	async loadUsers({ force = false } = {}) {
		const activeContainer = this.querySelector('[data-users-active-container]');
		const otherContainer = this.querySelector('[data-users-other-container]');
		if (!activeContainer || !otherContainer) return;

		try {
			const response = await fetch('/admin/users', { credentials: 'include' });
			if (!response.ok) throw new Error('Failed to load users.');
			const data = await response.json();

			const activeUsers = data.activeUsers ?? [];
			const otherUsers = data.otherUsers ?? [];

			activeContainer.innerHTML = '';
			otherContainer.innerHTML = '';

			if (activeUsers.length === 0) {
				const empty = document.createElement('div');
				empty.className = 'admin-empty';
				empty.textContent = 'No active users.';
				activeContainer.appendChild(empty);
			} else {
				for (const user of activeUsers) {
					activeContainer.appendChild(renderUserCard(user, (u) => this.openUserModal(u)));
				}
			}

			if (otherUsers.length === 0) {
				const empty = document.createElement('div');
				empty.className = 'admin-empty';
				empty.textContent = 'No other users.';
				otherContainer.appendChild(empty);
			} else {
				for (const user of otherUsers) {
					otherContainer.appendChild(renderUserCard(user, (u) => this.openUserModal(u)));
				}
			}

			// Restore active tab after refresh
			if (this._tabsEl && this._activeTabId) {
				this._tabsEl.setActiveTab(this._activeTabId, { focus: false });
			}
		} catch (err) {
			activeContainer.innerHTML = '';
			otherContainer.innerHTML = '';
			const error = document.createElement('div');
			error.className = 'admin-error';
			error.textContent = 'Error loading users.';
			activeContainer.appendChild(error);
		}
	}
}

customElements.define('app-route-users', AppRouteUsers);
