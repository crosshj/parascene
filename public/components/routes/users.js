import { getAvatarColor } from '../../shared/avatar.js';
import { formatRelativeTime, formatDateTime } from '../../shared/datetime.js';
import { buildProfilePath } from '../../shared/profileLinks.js';
import { loadAdminDataTable } from '../../shared/adminDataTable.js';

const html = String.raw;

function escapeHtml(text) {
	const s = String(text ?? '');
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

function truncateCid(cid, maxLen = 20) {
	const s = String(cid || '').trim();
	if (s.length <= maxLen) return s;
	return s.slice(0, 8) + '…' + s.slice(-8);
}

/** Format date in local timezone as YYYY-MM-DD HH:mm (no seconds or ms). */
function formatLocalDateTime(value) {
	if (!value) return '—';
	const d = typeof value === 'string' ? new Date(value) : value;
	if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
	const pad = (n) => (n < 10 ? '0' + n : String(n));
	const y = d.getFullYear();
	const m = d.getMonth() + 1;
	const day = d.getDate();
	const h = d.getHours();
	const min = d.getMinutes();
	return `${y}-${pad(m)}-${pad(day)} ${pad(h)}:${pad(min)}`;
}

function truncateStr(s, maxLen = 40) {
	const str = typeof s === 'string' ? s.trim() : '';
	if (!str) return '—';
	return str.length <= maxLen ? str : str.slice(0, maxLen) + '…';
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
	const isSubscribed = user?.meta?.plan === 'founder' || Boolean(user?.meta?.stripeSubscriptionId);
	if (isSubscribed) {
		const subBadge = document.createElement('span');
		subBadge.className = 'user-card-badge user-card-badge-founder';
		subBadge.textContent = 'Founder';
		nameRow.appendChild(subBadge);
	}
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

const USERS_TAB_IDS = ['active', 'share', 'anonymous', 'other'];


class AppRouteUsers extends HTMLElement {
	connectedCallback() {
		this._selectedAnonCid = null;
		this._anonDataLoaded = false;
		this._shareDataLoaded = false;
		this.innerHTML = html`
			<h3>Users</h3>
			<app-tabs>
				<tab data-id="active" label="Active" default>
					<div class="users-active-wrap">
						<div class="users-cards" data-users-active-container>
							<div class="route-empty route-loading">
								<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
							</div>
						</div>
						<div class="text-muted users-list-count" data-users-active-count aria-live="polite"></div>
					</div>
				</tab>
				<tab data-id="share" label="Share">
					<div class="share-tab-content" data-share-tab-content>
						<div class="share-table-container" data-share-table-container>
							<div class="route-empty route-loading">
								<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
							</div>
						</div>
					</div>
				</tab>
				<tab data-id="anonymous" label="Try flow">
					<div class="anon-tab-content" data-anon-tab-content>
						<div class="anon-table-container" data-anon-table-container>
							<div class="route-empty route-loading">
								<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
							</div>
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
			<div class="publish-modal-overlay" data-anon-detail-modal role="dialog" aria-modal="true"
				aria-labelledby="anon-detail-modal-title">
				<div class="publish-modal anon-detail-modal">
					<header class="publish-modal-header">
						<h3 id="anon-detail-modal-title" class="anon-detail-modal-title" data-anon-detail-title>Requests</h3>
						<button type="button" class="publish-modal-close" data-anon-detail-close aria-label="Close">✕</button>
					</header>
					<div class="publish-modal-body anon-detail-modal-body">
						<div class="anon-detail-requests" data-anon-detail-requests></div>
					</div>
				</div>
			</div>
		`;
		this._tabsEl = this.querySelector('app-tabs');
		this._tabsEl?.addEventListener('tab-change', (e) => {
			if (e.detail?.id) this._activeTabId = e.detail.id;
			if (e.detail?.id === 'anonymous' && !this._anonDataLoaded) {
				this.loadAnonCids();
			}
			if (e.detail?.id === 'share' && !this._shareDataLoaded) {
				this.loadShareViews();
			}
		});
		this.setupUsersTabHash();
		this._anonModalOverlay = this.querySelector('[data-anon-detail-modal]');
		this._anonModalOverlay?.addEventListener('click', (e) => {
			if (e.target === this._anonModalOverlay) this.closeAnonDetailModal();
		});
		this.querySelector('[data-anon-detail-close]')?.addEventListener('click', () => this.closeAnonDetailModal());
		this._boundAnonModalEscape = (e) => {
			if (e.key === 'Escape' && this._anonModalOverlay?.classList.contains('open')) {
				this.closeAnonDetailModal();
			}
		};
		document.addEventListener('keydown', this._boundAnonModalEscape);
		this.loadUsers();
		this._boundRefresh = () => this.loadUsers({ force: true });
		document.addEventListener('user-updated', this._boundRefresh);
	}

	disconnectedCallback() {
		document.removeEventListener('user-updated', this._boundRefresh);
		if (this._boundAnonModalEscape) {
			document.removeEventListener('keydown', this._boundAnonModalEscape);
		}
		if (this._usersTabHashCleanup) this._usersTabHashCleanup();
	}

	/** Sync Users tab from URL hash (#active, #share, #anonymous, #other) and update hash when tab changes (same pattern as Connect). */
	setupUsersTabHash() {
		const isOnUsersRoute = () => {
			const path = window.location.pathname || '';
			return path === '/users' || path.startsWith('/users/') || path === '' || path === '/';
		};

		const syncTabFromHash = () => {
			if (!isOnUsersRoute()) return;
			const hash = (window.location.hash || '').replace(/^#/, '').toLowerCase();
			const id = hash && USERS_TAB_IDS.includes(hash) ? hash : 'active';
			this._activeTabId = id;
			const tabs = this._tabsEl || this.querySelector('app-tabs');
			if (tabs && typeof tabs.setActiveTab === 'function') {
				tabs.setActiveTab(id, { focus: false });
			}
			if (id === 'anonymous' && !this._anonDataLoaded) {
				this.loadAnonCids();
			}
			if (id === 'share' && !this._shareDataLoaded) {
				this.loadShareViews();
			}
		};

		const onRouteChange = (e) => {
			if (e.detail?.route === 'users') syncTabFromHash();
		};

		const onHashChange = () => syncTabFromHash();

		setTimeout(() => {
			if (isOnUsersRoute()) syncTabFromHash();
			else this._activeTabId = 'active';
		}, 0);

		document.addEventListener('route-change', onRouteChange);
		window.addEventListener('hashchange', onHashChange);

		if (this._tabsEl) {
			this._tabsEl.addEventListener('tab-change', (e) => {
				const id = e.detail?.id;
				if (!id) return;
				if (!isOnUsersRoute()) return;
				const newHash = `#${id}`;
				if (window.location.hash !== newHash) {
					const path = window.location.pathname || '';
					const base = (path === '/' || path === '') ? '/users' : path;
					const search = window.location.search || '';
					window.history.replaceState(null, '', `${base}${search}${newHash}`);
				}
			});
		}

		this._usersTabHashCleanup = () => {
			document.removeEventListener('route-change', onRouteChange);
			window.removeEventListener('hashchange', onHashChange);
		};
	}

	openUserModal(user) {
		const modal = document.querySelector('app-modal-user');
		if (modal) modal.open(user);
	}

	closeAnonDetailModal() {
		this._selectedAnonCid = null;
		if (this._anonModalOverlay) this._anonModalOverlay.classList.remove('open');
		document.body.classList.remove('modal-open');
	}

	showAnonDetail(cid) {
		this._selectedAnonCid = cid;
		const titleEl = this.querySelector('[data-anon-detail-title]');
		const requestsEl = this.querySelector('[data-anon-detail-requests]');
		if (titleEl) titleEl.textContent = `Requests for ${truncateCid(cid)}`;
		if (requestsEl) {
			requestsEl.innerHTML = '<div class="route-empty route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>';
		}
		if (this._anonModalOverlay) {
			this._anonModalOverlay.classList.add('open');
			document.body.classList.add('modal-open');
		}
		this.loadAnonDetail(cid);
	}

	async loadAnonCids() {
		const container = this.querySelector('[data-anon-table-container]');
		if (!container) return;
		try {
			this._anonDataLoaded = true;
			await loadAdminDataTable(container, {
				fetchUrl: '/admin/anonymous-users',
				responseItemsKey: 'anonCids',
				columns: [
					{
						key: 'anon_cid',
						label: 'Client ID',
						sortKey: 'anon_cid',
						className: 'anon-table-col-cid',
						render: (row) => escapeHtml(truncateCid(row.anon_cid))
					},
					{
						key: 'from_share',
						label: 'Source',
						className: 'anon-table-col-source',
						render: (row) => (row.from_share ? 'share' : '')
					},
					{
						key: 'last_request_at',
						label: 'Date',
						sortKey: 'last_request_at',
						className: 'anon-table-col-dates',
						render: (row) => {
							const first = formatLocalDateTime(row.first_request_at);
							const last = formatLocalDateTime(row.last_request_at);
							return `<div class="anon-table-dates-cell"><span class="anon-table-date-line"><span class="anon-table-date-label">Last</span> ${escapeHtml(last)}</span><span class="anon-table-date-line"><span class="anon-table-date-label">First</span> ${escapeHtml(first)}</span></div>`;
						}
					},
					{ key: 'request_count', label: 'Count', sortKey: 'request_count', className: 'anon-table-col-count' },
					{
						key: 'user_agent',
						label: 'User agent',
						className: 'anon-table-col-user-agent',
						render: (row) => escapeHtml(truncateStr(row.user_agent ?? '', 60))
					},
					{
						key: 'ip',
						label: 'IP',
						className: 'anon-table-col-ip',
						render: (row) => escapeHtml(truncateStr(row.ip ?? '', 45))
					},
					{
						key: 'transitioned_user_id',
						label: 'Transitioned',
						className: 'anon-table-col-transitioned',
						render: (row) => {
							const uid = row.transitioned_user_id;
							const name = row.transitioned_user_name && String(row.transitioned_user_name).trim() ? String(row.transitioned_user_name).trim() : null;
							const profileHref = uid != null ? (buildProfilePath({ userName: name, userId: uid }) || `/user/${uid}`) : null;
							const label = uid != null ? (name ? `@${name}` : `User ${uid}`) : null;
							if (profileHref && label) {
								return `<a href="${escapeHtml(profileHref)}" class="anon-table-transitioned-link" onclick="event.stopPropagation()">${escapeHtml(label)}</a>`;
							}
							return uid != null ? 'Yes' : '—';
						}
					}
				],
				defaultSortBy: 'last_request_at',
				defaultSortDir: 'desc',
				emptyMessage: 'No try flow requests yet.',
				ariaLabelPagination: 'Try flow pagination',
				onRowClick: (row) => this.showAnonDetail(row.anon_cid),
				tableClassName: 'admin-table anon-table'
			});
		} catch (err) {
			container.innerHTML = '';
			const error = document.createElement('div');
			error.className = 'admin-error';
			error.textContent = 'Error loading try flow data.';
			container.appendChild(error);
		}
	}

	async loadShareViews() {
		const container = this.querySelector('[data-share-table-container]');
		if (!container) return;
		try {
			this._shareDataLoaded = true;
			await loadAdminDataTable(container, {
				fetchUrl: '/admin/share-views',
				responseItemsKey: 'items',
				columns: [
					{
						key: 'viewed_at',
						label: 'Viewed',
						sortKey: 'viewed_at',
						className: 'share-table-col-date',
						render: (row) => escapeHtml(row.viewed_at ? formatLocalDateTime(row.viewed_at) : '—')
					},
					{ key: 'sharer_label', label: 'Sharer', sortKey: 'sharer_user_id', className: 'share-table-col-sharer' },
					{ key: 'creator_label', label: 'Creator', sortKey: 'created_by_user_id', className: 'share-table-col-creator' },
					{
						key: 'created_image_id',
						label: 'Creation',
						sortKey: 'created_image_id',
						className: 'share-table-col-creation',
						render: (row) => {
							const raw = row.created_image_id;
							if (raw != null && Number.isFinite(Number(raw))) {
								return `<a href="/creations/${escapeHtml(String(raw))}">${escapeHtml(String(raw))}</a>`;
							}
							return escapeHtml(String(raw ?? '—'));
						}
					},
					{
						key: 'user_agent',
						label: 'User agent',
						className: 'share-table-col-user-agent',
						render: (row) => escapeHtml(truncateStr(row.user_agent ?? '', 60))
					},
					{
						key: 'ip',
						label: 'IP',
						className: 'share-table-col-ip',
						render: (row) => escapeHtml(truncateStr(row.ip ?? '', 45))
					},
					{
						key: 'referer',
						label: 'Referer',
						sortKey: 'referer',
						className: 'share-table-col-referer',
						render: (row) => escapeHtml(truncateStr(row.referer, 50))
					},
					{
						key: 'anon_cid',
						label: 'anon_cid',
						sortKey: 'anon_cid',
						className: 'share-table-col-cid',
						render: (row) => escapeHtml(truncateStr(row.anon_cid, 12))
					}
				],
				defaultSortBy: 'viewed_at',
				defaultSortDir: 'desc',
				emptyMessage: 'No share page views yet.',
				ariaLabelPagination: 'Share page views pagination',
				tableClassName: 'admin-table share-table anon-table'
			});
		} catch (err) {
			container.innerHTML = '';
			const error = document.createElement('div');
			error.className = 'admin-error';
			error.textContent = 'Error loading share views.';
			container.appendChild(error);
		}
	}

	async loadAnonDetail(cid) {
		const requestsEl = this.querySelector('[data-anon-detail-requests]');
		if (!requestsEl) return;
		try {
			const response = await fetch(`/admin/anonymous-users/${encodeURIComponent(cid)}`, { credentials: 'include' });
			if (!response.ok) throw new Error('Failed to load request details.');
			const data = await response.json();
			const requests = data.requests ?? [];
			requestsEl.innerHTML = '';
			if (requests.length === 0) {
				const empty = document.createElement('div');
				empty.className = 'admin-empty';
				empty.textContent = 'No requests.';
				requestsEl.appendChild(empty);
				return;
			}
			for (const req of requests) {
				const row = document.createElement('div');
				row.className = 'anon-request-row';
				const createdLabel = req.created_at ? formatRelativeTime(req.created_at, { style: 'long' }) : '—';
				const fulfilledLabel = req.fulfilled_at ? formatRelativeTime(req.fulfilled_at, { style: 'long' }) : '—';
				const promptEscaped = (req.prompt || '—').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
				const userAgentDisplay = truncateStr(req.user_agent ?? '', 50);
				const userAgentEscaped = (userAgentDisplay || '—').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
				const userAgentTitle = req.user_agent ? req.user_agent.replace(/"/g, '&quot;') : '';
				const ipEscaped = (req.ip ?? '—').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
				let imageBlock = '<span class="anon-request-no-image">No image</span>';
				if (req.image) {
					const img = req.image;
					const url = img.image_url || '';
					const altEscaped = (img.filename ? `Request image: ${img.filename}` : 'Request image').replace(/"/g, '&quot;');
					imageBlock = url
						? `<a href="${url}" target="_blank" rel="noopener noreferrer" class="anon-request-image-link"><img src="${url}" alt="${altEscaped}" class="anon-request-thumb" loading="lazy" decoding="async" /></a>`
						: `<span class="anon-request-no-image">${String(img.status || '—').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
				}
				row.innerHTML = `
					<div class="anon-request-prompt">${promptEscaped}</div>
					<div class="anon-request-meta">
						<span class="anon-request-datetime" title="${(req.created_at || '').replace(/"/g, '&quot;')}">${createdLabel}</span>
						<span class="anon-request-fulfilled">Fulfilled ${fulfilledLabel}</span>
						${req.ip ? `<span class="anon-request-ip">${ipEscaped}</span>` : ''}
						${req.user_agent ? `<span class="anon-request-user-agent" title="${userAgentTitle}">${userAgentEscaped}</span>` : ''}
					</div>
					<div class="anon-request-image">${imageBlock}</div>
				`;
				requestsEl.appendChild(row);
			}
		} catch (err) {
			requestsEl.innerHTML = '';
			const error = document.createElement('div');
			error.className = 'admin-error';
			error.textContent = 'Error loading request details.';
			requestsEl.appendChild(error);
		}
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
			const activeCountEl = this.querySelector('[data-users-active-count]');
			if (activeCountEl) {
				activeCountEl.textContent = activeUsers.length === 1
				? 'TOTAL: 1 active user'
				: `TOTAL: ${activeUsers.length} active users`;
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
			const activeCountEl = this.querySelector('[data-users-active-count]');
			if (activeCountEl) activeCountEl.textContent = '';
			const error = document.createElement('div');
			error.className = 'admin-error';
			error.textContent = 'Error loading users.';
			activeContainer.appendChild(error);
		}
	}
}

customElements.define('app-route-users', AppRouteUsers);
