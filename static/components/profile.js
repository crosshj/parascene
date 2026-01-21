import { formatDate } from '../shared/datetime.js';

const html = String.raw;

class AppProfile extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._isOpen = false;
    this.profileLoading = false;
    this.profileLoadedAt = 0;
    this.profileData = null;
    this.handleEscape = this.handleEscape.bind(this);
    this.handleOpenEvent = this.handleOpenEvent.bind(this);
    this.handleCloseEvent = this.handleCloseEvent.bind(this);
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    this.prefetchProfile();
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this.handleEscape);
    document.removeEventListener('open-profile', this.handleOpenEvent);
    document.removeEventListener('close-profile', this.handleCloseEvent);
  }

  setupEventListeners() {
    document.addEventListener('keydown', this.handleEscape);
    document.addEventListener('open-profile', this.handleOpenEvent);
    document.addEventListener('close-profile', this.handleCloseEvent);

    const overlay = this.shadowRoot.querySelector('.profile-overlay');
    const closeButton = this.shadowRoot.querySelector('.profile-close');

    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.close();
        }
      });
    }

    if (closeButton) {
      closeButton.addEventListener('click', () => {
        this.close();
      });
    }
  }

  handleOpenEvent() {
    this.open();
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

  open() {
    if (this._isOpen) return;
    this._isOpen = true;
    const overlay = this.shadowRoot.querySelector('.profile-overlay');
    if (overlay) {
      overlay.classList.add('open');
      this.loadProfile({ silent: true });
    }
    // Dispatch event to close notifications if open
    document.dispatchEvent(new CustomEvent('close-notifications'));
  }

  close() {
    if (!this._isOpen) return;
    this._isOpen = false;
    const overlay = this.shadowRoot.querySelector('.profile-overlay');
    if (overlay) {
      overlay.classList.remove('open');
    }
  }

  async loadProfile({ silent = true, force = false } = {}) {
    const content = this.shadowRoot.querySelector('.profile-content');
    if (!content) return;

    if (this.profileLoading) return;
    const now = Date.now();
    if (!force && now - this.profileLoadedAt < 30000) return;

    try {
      this.profileLoading = true;
      const response = await fetch('/api/profile', {
        credentials: 'include'
      });
      if (!response.ok) {
        if (response.status === 401) {
          if (!this.profileData) {
            content.innerHTML = html`<p style="color: var(--text-muted);">Please log in to view your profile.</p>`;
          }
          return;
        }
        throw new Error('Failed to load profile');
      }

      const user = await response.json();
      const nextKey = user
        ? `${user.email || ''}|${user.role || ''}|${user.created_at || ''}`
        : '';
      const currentKey = this.profileData
        ? `${this.profileData.email || ''}|${this.profileData.role || ''}|${this.profileData.created_at || ''}`
        : '';

      if (nextKey !== currentKey) {
        this.profileData = user;
        this.displayProfile(user);
      }
      this.profileLoadedAt = Date.now();
    } catch (error) {
      console.error('Error loading profile:', error);
      if (!silent && !this.profileData) {
        content.innerHTML = html`<p style="color: var(--text-muted);">Failed to load profile information.</p>`;
      }
    } finally {
      this.profileLoading = false;
    }
  }

  displayProfile(user) {
    const content = this.shadowRoot.querySelector('.profile-content');
    if (!content) return;

    const roleLabels = {
      consumer: 'Consumer',
      creator: 'Creator',
      provider: 'Provider',
      admin: 'Administrator'
    };

    const escapeHtml = (text) => {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    };

    content.innerHTML = html`
      <div class="field">
        <label>Email</label>
        <div class="value">${escapeHtml(user.email)}</div>
      </div>
      <div class="field">
        <label>Role</label>
        <div class="value">${escapeHtml(roleLabels[user.role] || user.role)}</div>
      </div>
      <div class="field">
        <label>Member Since</label>
        <div class="value">${formatDate(user.created_at) || 'N/A'}</div>
      </div>
    `;
  }

  render() {
    this.shadowRoot.innerHTML = html`
      <style>
        :host {
          display: block;
        }
        .profile-overlay {
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
        .profile-overlay.open {
          opacity: 1;
          visibility: visible;
        }
        .profile-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          box-shadow: var(--shadow);
          max-width: 500px;
          width: 90%;
          max-height: 90vh;
          overflow-y: auto;
          transform: scale(0.95);
          transition: transform 0.2s;
        }
        .profile-overlay.open .profile-modal {
          transform: scale(1);
        }
        .profile-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 20px;
          border-bottom: 1px solid var(--border);
        }
        .profile-header h2 {
          margin: 0;
          font-size: 1.5rem;
        }
        .profile-close {
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
        .profile-close:hover {
          background: var(--surface-strong);
        }
        .profile-close-icon {
          width: 24px;
          height: 24px;
        }
        .profile-body {
          padding: 20px;
        }
        .profile-actions {
          display: flex;
          justify-content: flex-end;
          padding: 0 20px 20px;
        }
        .logout-button {
          padding: 8px 14px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--surface-strong);
          color: var(--text);
          cursor: pointer;
          font-weight: 600;
        }
        .logout-button:hover {
          border-color: var(--accent);
          background: var(--surface);
        }
        .field {
          margin: 12px 0;
        }
        .field:first-child {
          margin-top: 0;
        }
        .field:last-child {
          margin-bottom: 0;
        }
        .field label,
        .field .label {
          display: block;
          font-weight: 600;
          margin-bottom: 6px;
          color: var(--text-muted);
          font-size: 0.9rem;
        }
        .field .value {
          font-size: 1rem;
          color: var(--text);
        }
      </style>
      <div class="profile-overlay">
        <div class="profile-modal">
          <div class="profile-header">
            <h2>Profile</h2>
            <button class="profile-close" aria-label="Close">
              <svg class="profile-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="profile-body">
            <div class="profile-content"></div>
          </div>
          <div class="profile-actions">
            <form action="/logout" method="post">
              <button type="submit" class="logout-button">Logout</button>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  prefetchProfile() {
    const schedule = window.requestIdleCallback
      ? window.requestIdleCallback.bind(window)
      : (cb) => setTimeout(cb, 200);
    schedule(() => {
      this.loadProfile({ silent: true, force: true });
    });
  }
}

customElements.define('app-profile', AppProfile);
