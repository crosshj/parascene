import { formatRelativeTime } from '../../shared/datetime.js';
import { fetchJsonWithStatusDeduped } from '../../shared/api.js';

const html = String.raw;

class AppRouteServers extends HTMLElement {
	connectedCallback() {
		this.innerHTML = html`
      <div class="servers-route">
        <div class="route-header">
          <h3>Servers</h3>
          <p>Browse and manage image generation servers.</p>
        </div>
        <div class="route-cards admin-cards" data-servers-container>
          <div class="route-empty route-loading">
            <div class="route-loading-spinner" aria-label="Loading" role="status"></div>
          </div>
        </div>
      </div>
    `;

		this.loadServers();
	}

	// Listen for server updates from modal
	setupEventListeners() {
		document.addEventListener('server-updated', () => {
			this.loadServers({ force: true });
		});
	}

	async loadServers({ force = false } = {}) {
		const container = this.querySelector('[data-servers-container]');
		if (!container) return;

		try {
			const result = await fetchJsonWithStatusDeduped('/api/servers', { credentials: 'include' }, { windowMs: 2000 });
			if (!result.ok) {
				throw new Error('Failed to load servers');
			}

			const servers = Array.isArray(result.data?.servers) ? result.data.servers : [];
			this.renderServers(servers, container);
		} catch (error) {
			console.error('Error loading servers:', error);
			container.innerHTML = '<div class="route-empty">Error loading servers.</div>';
		}
	}

	renderServers(servers, container) {
		container.innerHTML = '';

		// Rely on server-side (ID ascending) ordering so client matches API.
		const sortedServers = [...servers];

		sortedServers.forEach(server => {
			const card = document.createElement('div');
			card.className = 'card admin-card server-card';
			card.dataset.serverId = server.id;
			card.style.cursor = 'pointer';

			const badges = [];
			// Special "home" server (id = 1) has a dedicated Home tag.
			if (server.id === 1) {
				badges.push('<span class="server-badge server-badge-member">Home</span>');
			} else {
				if (server.is_owner) {
					badges.push('<span class="server-badge server-badge-owner">Owned</span>');
				}
				if (server.is_member && !server.is_owner) {
					badges.push('<span class="server-badge server-badge-member">Joined</span>');
				}
			}

			const name = document.createElement('div');
			name.className = 'admin-title';
			name.innerHTML = `${server.name || 'Unnamed Server'} ${badges.join('')}`;

			const meta = document.createElement('div');
			meta.className = 'admin-meta';
			meta.textContent = `${server.status || 'unknown'}`;
			// Special server (id = 1) should not display member counts.
			if (typeof server.members_count === 'number' && server.id !== 1) {
				meta.textContent += ` • ${server.members_count} member${server.members_count !== 1 ? 's' : ''}`;
			}

			const hasDescription = typeof server.description === 'string' && server.description.trim().length > 0;
			const descriptionText = hasDescription ? server.description.trim() : '';

			const created = document.createElement('div');
			created.className = 'admin-timestamp';
			created.textContent = server.created_at ? formatRelativeTime(server.created_at, { style: 'long' }) : '—';

			card.appendChild(name);

			if (hasDescription) {
				const desc = document.createElement('div');
				desc.className = 'admin-detail';
				desc.textContent = descriptionText;
				card.appendChild(desc);
			}

			card.appendChild(meta);
			card.appendChild(created);

			// Click card to view details
			card.addEventListener('click', () => {
				const modal = document.querySelector('app-modal-server');
				if (modal) {
					modal.open({
						mode: server.can_manage ? 'edit' : 'view',
						serverId: server.id
					});
				}
			});

			container.appendChild(card);
		});

		// Ghost card for adding a custom server (always last).
		const ghostCard = document.createElement('button');
		ghostCard.type = 'button';
		ghostCard.className = 'card server-card server-card-ghost';
		ghostCard.setAttribute('aria-label', 'Add custom server');

		const ghostTitle = document.createElement('div');
		ghostTitle.className = 'server-card-ghost-title';
		ghostTitle.textContent = 'Add custom server';

		const ghostSubtitle = document.createElement('div');
		ghostSubtitle.className = 'server-card-ghost-subtitle';
		ghostSubtitle.textContent = 'Register your own image generation server.';

		ghostCard.appendChild(ghostTitle);
		ghostCard.appendChild(ghostSubtitle);

		ghostCard.addEventListener('click', () => {
			const modal = document.querySelector('app-modal-server');
			if (modal) {
				modal.open({ mode: 'add' });
			}
		});

		container.appendChild(ghostCard);
	}

	async handleJoin(serverId) {
		try {
			const response = await fetch(`/api/servers/${serverId}/join`, {
				method: 'POST',
				credentials: 'include'
			});

			const data = await response.json();
			if (!response.ok) {
				alert(data.error || 'Failed to join server');
				return;
			}

			// Reload servers
			await this.loadServers({ force: true });
		} catch (error) {
			console.error('Error joining server:', error);
			alert('Failed to join server');
		}
	}

	async handleLeave(serverId) {
		if (!confirm('Are you sure you want to leave this server?')) {
			return;
		}

		try {
			const response = await fetch(`/api/servers/${serverId}/leave`, {
				method: 'POST',
				credentials: 'include'
			});

			const data = await response.json();
			if (!response.ok) {
				alert(data.error || 'Failed to leave server');
				return;
			}

			// Reload servers
			await this.loadServers({ force: true });
		} catch (error) {
			console.error('Error leaving server:', error);
			alert('Failed to leave server');
		}
	}
}

customElements.define('app-route-servers', AppRouteServers);
