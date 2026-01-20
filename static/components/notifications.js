const html = String.raw;

class AppNotifications extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._isOpen = false;
    this.notifications = [];
    this.activeIndex = 0;
    this.pendingNotificationId = null;
    this.viewMode = 'list';
    this.handleEscape = this.handleEscape.bind(this);
    this.handleOpenEvent = this.handleOpenEvent.bind(this);
    this.handleCloseEvent = this.handleCloseEvent.bind(this);
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this.handleEscape);
    document.removeEventListener('open-notifications', this.handleOpenEvent);
    document.removeEventListener('close-notifications', this.handleCloseEvent);
  }

  setupEventListeners() {
    document.addEventListener('keydown', this.handleEscape);
    document.addEventListener('open-notifications', this.handleOpenEvent);
    document.addEventListener('close-notifications', this.handleCloseEvent);
    document.addEventListener('notifications-acknowledged', () => {
      // Reload notifications when one is acknowledged
      if (this.isOpen()) {
        this.loadNotifications();
      }
    });

    const overlays = this.shadowRoot.querySelectorAll(
      '.notifications-overlay, .notification-detail-overlay'
    );
    const closeButtons = this.shadowRoot.querySelectorAll('.notifications-close');

    overlays.forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.close();
        }
      });
    });

    closeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.close();
      });
    });
  }

  handleOpenEvent(event) {
    const notificationId = event?.detail?.notificationId ?? null;
    if (notificationId) {
      this.openDetail(notificationId);
    } else {
      this.openList();
    }
  }

  handleCloseEvent() {
    this.close();
  }

  handleEscape(e) {
    if (e.key === 'Escape' && this.isOpen()) {
      this.close();
    }
  }

  isOpen() {
    return this._isOpen;
  }

  openList() {
    this.viewMode = 'list';
    this.pendingNotificationId = null;
    this.openModal('.notifications-overlay');
    this.loadNotifications();
    document.dispatchEvent(new CustomEvent('close-profile'));
  }

  openDetail(notificationId) {
    this.viewMode = 'detail';
    this.pendingNotificationId = notificationId;
    this.openModal('.notification-detail-overlay');
    this.loadNotifications();
    document.dispatchEvent(new CustomEvent('close-profile'));
  }

  openModal(selector) {
    const overlays = this.shadowRoot.querySelectorAll(
      '.notifications-overlay, .notification-detail-overlay'
    );
    overlays.forEach((overlay) => overlay.classList.remove('open'));
    this._isOpen = true;
    const overlay = this.shadowRoot.querySelector(selector);
    if (overlay) {
      overlay.classList.add('open');
    }
  }

  close() {
    if (!this._isOpen) return;
    this._isOpen = false;
    const overlays = this.shadowRoot.querySelectorAll(
      '.notifications-overlay, .notification-detail-overlay'
    );
    overlays.forEach((overlay) => overlay.classList.remove('open'));
  }

  async loadNotifications() {
    const listContent = this.shadowRoot.querySelector('.notifications-content');
    const detailContent = this.shadowRoot.querySelector('.notification-detail-content');
    const content = this.viewMode === 'detail' ? detailContent : listContent;
    if (!content) return;

    content.innerHTML = html`<p>Loading...</p>`;

    try {
      const response = await fetch('/api/notifications', {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to load notifications');
      }
      const data = await response.json();
      this.notifications = Array.isArray(data.notifications)
        ? data.notifications
        : [];
      this.selectActiveNotification();
      if (this.viewMode === 'detail') {
        this.renderNotificationDetail();
      } else {
        this.renderNotificationList();
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
      if (content) {
        content.innerHTML = html`<p style="color: var(--text-muted);">Failed to load notifications.</p>`;
      }
    }
  }

  async acknowledgeNotification(id) {
    try {
      const response = await fetch('/api/notifications/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id: String(id) }),
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to acknowledge notification');
      }
      const data = await response.json();
      if (data.updated) {
        // Update local notification state
        const notification = this.notifications.find(n => n.id === id);
        if (notification) {
          notification.acknowledged_at = new Date().toISOString();
        }
        // Reload notifications to get fresh data from server
        await this.loadNotifications();
        // Dispatch event for other components (like header count)
        document.dispatchEvent(new CustomEvent('notifications-acknowledged'));
      }
    } catch (error) {
      console.error('Error acknowledging notification:', error);
    }
  }

  selectActiveNotification() {
    if (!this.notifications.length) {
      this.activeIndex = 0;
      return;
    }

    if (this.pendingNotificationId) {
      const index = this.notifications.findIndex(
        (notification) => notification.id === this.pendingNotificationId
      );
      this.activeIndex = index >= 0 ? index : 0;
    } else if (this.activeIndex >= this.notifications.length) {
      this.activeIndex = 0;
    }
  }

  renderNotificationList() {
    const content = this.shadowRoot.querySelector('.notifications-content');
    if (!content) return;

    if (!this.notifications.length) {
      content.innerHTML = html`<p style="color: var(--text-muted);">No notifications.</p>`;
      return;
    }

    const escapeHtml = (text) => {
      const div = document.createElement('div');
      div.textContent = text ?? '';
      return div.innerHTML;
    };

    content.innerHTML = this.notifications.map((notification) => html`
      <button class="notification-list-item ${notification.acknowledged_at ? 'is-read' : 'is-unread'}" data-id="${notification.id}">
        <div class="notification-list-title">${escapeHtml(notification.title || 'Notification')}</div>
        <div class="notification-list-message">${escapeHtml(notification.message || '')}</div>
        <div class="notification-list-time">${escapeHtml(notification.created_at || '')}</div>
      </button>
    `).join('');

    content.querySelectorAll('.notification-list-item').forEach((item) => {
      item.addEventListener('click', () => {
        const id = Number(item.getAttribute('data-id'));
        if (id) {
          this.openDetail(id);
        }
      });
    });
  }

  renderNotificationDetail() {
    const content = this.shadowRoot.querySelector('.notification-detail-content');
    if (!content) return;

    if (!this.notifications.length) {
      content.innerHTML = html`<p style="color: var(--text-muted);">No notifications.</p>`;
      return;
    }

    const escapeHtml = (text) => {
      const div = document.createElement('div');
      div.textContent = text ?? '';
      return div.innerHTML;
    };

    const notification = this.notifications[this.activeIndex];

    if (!notification.acknowledged_at) {
      this.acknowledgeNotification(notification.id);
      notification.acknowledged_at = new Date().toISOString();
    }

    content.innerHTML = html`
      <div class="notification-detail">
        <div class="notification-detail-header">
          <div class="notification-title">${escapeHtml(notification.title || 'Notification')}</div>
        </div>
        <div class="notification-message">${escapeHtml(notification.message || '')}</div>
        <div class="notification-time">${escapeHtml(notification.created_at || '')}</div>
        ${notification.link ? html`
          <a class="notification-link" href="${escapeHtml(notification.link)}">Open related page</a>
        ` : ''}
        <button class="notification-view-all">View all notifications</button>
      </div>
    `;

    const viewAllButton = this.shadowRoot.querySelector('.notification-view-all');
    if (viewAllButton) {
      viewAllButton.addEventListener('click', () => {
        this.close();
        this.openList();
      });
    }
  }

  render() {
    this.shadowRoot.innerHTML = html`
      <style>
        :host {
          display: block;
        }
        .notifications-overlay,
        .notification-detail-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 99999;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s, visibility 0.2s;
        }
        .notifications-overlay.open,
        .notification-detail-overlay.open {
          opacity: 1;
          visibility: visible;
        }
        .notifications-modal,
        .notification-detail-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          box-shadow: var(--shadow);
          width: 520px;
          height: 360px;
          max-width: 92vw;
          max-height: 90vh;
          overflow: hidden;
          transform: scale(0.95);
          transition: transform 0.2s;
        }
        .notifications-modal {
          width: 760px;
          height: 560px;
        }
        .notifications-overlay.open .notifications-modal,
        .notification-detail-overlay.open .notification-detail-modal {
          transform: scale(1);
        }
        .notifications-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 20px;
          border-bottom: 1px solid var(--border);
        }
        .notifications-header h2 {
          margin: 0;
          font-size: 1.5rem;
        }
        .notifications-close {
          background: transparent;
          border: none;
          color: var(--text);
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          transition: background-color 0.2s;
        }
        .notifications-close:hover {
          background: var(--surface-strong);
        }
        .notifications-close-icon {
          width: 24px;
          height: 24px;
        }
        .notifications-body {
          padding: 20px;
          padding-bottom: 36px;
          height: calc(100% - 64px);
          overflow-y: auto;
        }
        .notifications-content {
          min-height: 100px;
        }
        .notification-detail-body {
          padding: 20px;
          padding-bottom: 36px;
          height: calc(100% - 64px);
          overflow-y: auto;
        }
        .notification-title {
          font-weight: 600;
          font-size: 0.95rem;
          color: var(--text);
          margin-bottom: 4px;
        }
        .notification-message {
          font-size: 0.9rem;
          color: var(--text-muted);
          margin-bottom: 8px;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .notification-time {
          font-size: 0.85rem;
          color: var(--text-muted);
        }
        .notification-detail {
          display: grid;
          gap: 8px;
        }
        .notification-detail-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
        }
        .notification-list-item {
          width: 100%;
          display: grid;
          gap: 6px;
          padding: 12px 0;
          border: none;
          border-bottom: 1px solid var(--border);
          background: transparent;
          text-align: left;
          cursor: pointer;
          color: inherit;
          font: inherit;
          position: relative;
          padding-left: 14px;
        }
        .notification-list-item.is-read {
          opacity: 0.65;
        }
        .notification-list-item.is-unread .notification-list-title {
          color: var(--text);
        }
        .notification-list-item.is-unread::before {
          content: '';
          position: absolute;
          top: 18px;
          left: 0;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          opacity: 0.85;
        }
        .notification-list-item:last-child {
          border-bottom: none;
        }
        .notification-list-title {
          font-weight: 600;
          font-size: 0.95rem;
          color: var(--text);
        }
        .notification-list-message {
          font-size: 0.9rem;
          color: var(--text-muted);
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .notification-list-time {
          font-size: 0.85rem;
          color: var(--text-muted);
        }
        .notification-link {
          font-size: 0.85rem;
          color: var(--accent);
          text-decoration: none;
        }
        .notification-link:hover {
          text-decoration: underline;
        }
        .notification-view-all {
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface-strong);
          color: var(--text);
          cursor: pointer;
          font: inherit;
          width: fit-content;
        }
        .notification-view-all:hover {
          background: var(--surface);
        }
      </style>
      <div class="notifications-overlay">
        <div class="notifications-modal">
          <div class="notifications-header">
            <h2>Notifications</h2>
            <button class="notifications-close" aria-label="Close">
              <svg class="notifications-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="notifications-body">
            <div class="notifications-content">
              <p>Loading...</p>
            </div>
          </div>
        </div>
      </div>
      <div class="notification-detail-overlay">
        <div class="notification-detail-modal">
          <div class="notifications-header">
            <h2>Notification</h2>
            <button class="notifications-close" aria-label="Close">
              <svg class="notifications-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="notification-detail-body">
            <div class="notification-detail-content">
              <p>Loading...</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('app-notifications', AppNotifications);
