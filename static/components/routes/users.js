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

class AppRouteUsers extends HTMLElement {
	connectedCallback() {
		this.innerHTML = html`
			<h3>Users</h3>
			<div class="users-cards" data-users-container>
				<div class="route-empty route-loading">
					<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
				</div>
			</div>
		`;
		this.loadUsers();
		this._boundRefresh = () => this.loadUsers({ force: true });
		document.addEventListener('user-updated', this._boundRefresh);
	}

	disconnectedCallback() {
		document.removeEventListener('user-updated', this._boundRefresh);
	}

	async loadUsers({ force = false } = {}) {
		const container = this.querySelector('[data-users-container]');
		if (!container) return;

		try {
			const response = await fetch('/admin/users', { credentials: 'include' });
			if (!response.ok) throw new Error('Failed to load users.');
			const data = await response.json();

			container.innerHTML = '';
			if (!data.users || data.users.length === 0) {
				const empty = document.createElement('div');
				empty.className = 'admin-empty';
				empty.textContent = 'No users yet.';
				container.appendChild(empty);
				return;
			}

			for (const user of data.users) {
				const card = document.createElement('div');
				card.className = 'card user-card';
				card.dataset.userId = String(user.id);
				card.tabIndex = 0;
				card.setAttribute('role', 'button');
				const { avatar, displayName } = createUserAvatar(user, getAvatarColor);
				card.setAttribute('aria-label', `Open user ${displayName}`);
				card.addEventListener('click', () => this.openUserModal(user));
				card.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						this.openUserModal(user);
					}
				});

				const header = document.createElement('div');
				header.className = 'user-card-header';
				const info = document.createElement('div');
				info.className = 'user-card-info';
				const title = document.createElement('div');
				title.className = 'user-title';
				const nameEl = document.createElement('div');
				nameEl.className = 'user-name';
				nameEl.textContent = displayName;
				title.appendChild(nameEl);
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

				card.appendChild(header);
				card.appendChild(created);
				container.appendChild(card);
			}
		} catch (err) {
			container.innerHTML = '';
			const error = document.createElement('div');
			error.className = 'admin-error';
			error.textContent = 'Error loading users.';
			container.appendChild(error);
		}
	}

	openUserModal(user) {
		const modal = document.querySelector('app-modal-user');
		if (modal) modal.open(user);
	}
}

customElements.define('app-route-users', AppRouteUsers);
