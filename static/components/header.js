import { formatDateTime, formatRelativeTime } from '../shared/datetime.js';

const html = String.raw;

class AppHeader extends HTMLElement {
  constructor() {
    super();
    this.notificationsMenuOpen = false;
    this.mobileMenuOpen = false;
    this.notificationsCount = 0;
    this.creditsCount = 0;
    this.previewNotifications = [];
    this.previewLoadedAt = 0;
    this.previewLoading = false;
    this.handleDocumentClick = this.handleDocumentClick.bind(this);
    this.handleRouteChange = this.handleRouteChange.bind(this);
    this.handleNotificationsUpdated = this.handleNotificationsUpdated.bind(this);
    this.handleCreditsUpdated = this.handleCreditsUpdated.bind(this);
    this.handleCreditsClaimStatus = this.handleCreditsClaimStatus.bind(this);
    this.routes = [];
    this.authLinks = [];
    this.defaultRoute = null;
    this.hasParsedRoutes = false;
  }

  static get observedAttributes() {
    return ['show-notifications', 'show-profile', 'show-create', 'default-route', 'credits-count'];
  }

  connectedCallback() {
    // Parse routes if not already parsed (attributeChangedCallback might have run first)
    if (!this.hasParsedRoutes) {
      this.parseRoutesFromChildren();
    }
    
    // Now render (which will replace innerHTML and children)
    this.render();
    this.setupEventListeners();
    this.setupNavListeners();
    document.addEventListener('click', this.handleDocumentClick);
    window.addEventListener('popstate', this.handleRouteChange);
    document.addEventListener('notifications-acknowledged', this.handleNotificationsUpdated);
    document.addEventListener('credits-updated', this.handleCreditsUpdated);
    document.addEventListener('credits-claim-status', this.handleCreditsClaimStatus);
    this.loadNotificationCount();
    this.loadCreditsCount();
    this.updateCreditsAttention();
    this.prefetchNotificationPreview();
    // Small delay to ensure DOM is ready for route change handler
    setTimeout(() => this.handleRouteChange(), 0);
  }

  disconnectedCallback() {
    document.removeEventListener('click', this.handleDocumentClick);
    window.removeEventListener('popstate', this.handleRouteChange);
    document.removeEventListener('notifications-acknowledged', this.handleNotificationsUpdated);
    document.removeEventListener('credits-updated', this.handleCreditsUpdated);
    document.removeEventListener('credits-claim-status', this.handleCreditsClaimStatus);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    // Parse routes BEFORE rendering if not already parsed
    if (!this.hasParsedRoutes) {
      this.parseRoutesFromChildren();
    }
    
    if (name === 'default-route' && oldValue !== newValue) {
      this.defaultRoute = newValue;
      if (this.hasParsedRoutes) {
        this.handleRouteChange();
      }
    } else if (name === 'credits-count' && oldValue !== newValue) {
      this.creditsCount = this.parseCreditsCount(newValue);
      this.updateCreditsUI(this.creditsCount);
    } else {
      // Re-render to update UI
      this.render();
      this.setupEventListeners();
      this.setupNavListeners();
      this.loadNotificationCount();
      this.loadCreditsCount();
    }
  }
  
  parseRoutesFromChildren() {
    // Parse routes from direct children - must be called BEFORE render()
    const children = Array.from(this.children);
    const userRole = window.__USER_ROLE__;
    const shouldIncludeRoute = (child) => {
      if (!child.hasAttribute('data-role-only')) {
        return true;
      }
      if (!userRole) {
        return false;
      }
      return child.getAttribute('data-role-only') === userRole;
    };
    
    const routeLinks = children.filter(child => 
      child.tagName === 'A' && child.hasAttribute('data-route') && shouldIncludeRoute(child)
    );
    
    this.routes = routeLinks.map(link => ({
      id: link.getAttribute('data-route'),
      label: link.textContent.trim()
    }));
    
    if (!Array.isArray(this.routes)) {
      this.routes = [];
    }
    
    // Parse auth links (links with class header-auth-link)
    const authLinks = children.filter(child => 
      child.tagName === 'A' && child.classList.contains('header-auth-link')
    );
    
    this.authLinks = authLinks.map(link => ({
      href: link.getAttribute('href') || '#',
      text: link.textContent.trim(),
      isPrimary: link.classList.contains('btn-primary')
    }));
    
    if (!Array.isArray(this.authLinks)) {
      this.authLinks = [];
    }
    
    this.defaultRoute = this.getAttribute('default-route') || this.routes[0]?.id;
    this.hasParsedRoutes = true;
  }


  setupNavListeners() {
    const navLinks = this.querySelectorAll('.header-nav .nav-link');
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const route = link.getAttribute('data-route');
        if (route) {
          // Check if we're on a server-sent page (like creation detail)
          // If so, use full page navigation for ANY route change
          const isServerSentPage = /^\/creations\/\d+$/.test(window.location.pathname) ||
            window.location.pathname.startsWith('/help/');
          if (isServerSentPage) {
            // Use full page navigation for server-sent pages
            window.location.href = `/${route}`;
            return;
          }
          // Use History API with pathname-based routing for client-side pages
          window.history.pushState({ route }, '', `/${route}`);
          this.handleRouteChange();
        }
      });
    });
  }

  updateCreateButtonState() {
    const createButtons = this.querySelectorAll('.create-button');
    if (createButtons.length === 0) return;
    
    const pathname = window.location.pathname;
    const currentRoute = pathname === '/' || pathname === '' ? this.defaultRoute : pathname.slice(1);
    const isCreateRoute = currentRoute === 'create';
    
    createButtons.forEach(createButton => {
      createButton.disabled = isCreateRoute;
    });
  }

  async loadNotificationCount() {
    if (!this.hasAttribute('show-notifications')) return;

    try {
      const response = await fetch('/api/notifications/unread-count', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to load notifications count');
      const data = await response.json();
      const count = Number(data.count || 0);
      this.updateNotificationsUI(count);
    } catch {
      this.updateNotificationsUI(0);
    }
  }

  updateNotificationsUI(count) {
    this.notificationsCount = count;
    const badge = this.querySelector('.notifications-badge');
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
      } else {
        badge.textContent = '';
      }
    }

    const status = this.querySelector('.notifications-status');
    if (status) {
      status.textContent =
        count > 0
          ? `${count} new notification${count === 1 ? '' : 's'}`
          : 'No new notifications';
    }
  }

  async loadCreditsCount() {
    if (!this.hasAttribute('show-profile')) return;

    if (this.hasAttribute('credits-count')) {
      const count = this.parseCreditsCount(this.getAttribute('credits-count'));
      this.updateCreditsUI(count);
      return;
    }

    const storedCount = this.readStoredCreditsCount();
    if (storedCount !== null) {
      this.updateCreditsUI(storedCount);
      return;
    }

    try {
      const response = await fetch('/api/profile', { credentials: 'include' });
      if (!response.ok) {
        this.updateCreditsUI(0);
        return;
      }
      const user = await response.json();
      const count = this.parseCreditsCount(user?.credits);
      this.updateCreditsUI(count);
    } catch {
      this.updateCreditsUI(0);
    }
  }

  updateCreditsUI(count) {
    this.creditsCount = count;
    const creditsCount = this.querySelector('.credits-count');
    if (creditsCount) {
      // Format credits: if there's a non-zero decimal remainder, show as "X+" (rounded down)
      // Otherwise show the whole number without decimal
      const normalized = this.parseCreditsCount(count);
      const wholePart = Math.floor(normalized);
      const decimalPart = normalized - wholePart;
      const formatted = decimalPart > 0 ? `${wholePart}+` : String(wholePart);
      creditsCount.textContent = formatted;
    }
  }

  parseCreditsCount(value) {
    const count = Number(value);
    if (!Number.isFinite(count)) return 0;
    return Math.max(0, Math.round(count * 10) / 10);
  }

  handleCreditsUpdated(event) {
    const count = this.parseCreditsCount(event?.detail?.count);
    this.updateCreditsUI(count);
  }

  handleCreditsClaimStatus(event) {
    const canClaim = Boolean(event?.detail?.canClaim);
    this.updateCreditsAttention(canClaim);
  }

  updateCreditsAttention(forceCanClaim) {
    const creditsButton = this.querySelector('.credits-button');
    if (!creditsButton) return;
    const canClaim = typeof forceCanClaim === 'boolean' ? forceCanClaim : this.getCreditsClaimStatus();
    creditsButton.classList.toggle('attention', canClaim);
  }

  getCreditsClaimStatus() {
    try {
      const lastClaim = window.localStorage?.getItem('credits-last-claim');
      if (!lastClaim) return true;
      const today = new Date().toISOString().slice(0, 10);
      return lastClaim !== today;
    } catch {
      return false;
    }
  }

  readStoredCreditsCount() {
    try {
      const stored = window.localStorage?.getItem('credits-balance');
      if (stored == null) return null;
      const parsed = this.parseCreditsCount(stored);
      return parsed;
    } catch {
      return null;
    }
  }

  async loadNotificationPreview({ silent = true, force = false } = {}) {
    if (!this.hasAttribute('show-notifications')) return;

    const preview = this.querySelector('.notifications-preview');
    if (!preview) return;

    if (this.previewLoading) return;
    const now = Date.now();
    if (!force && now - this.previewLoadedAt < 30000) return;

    try {
      this.previewLoading = true;
      const response = await fetch('/api/notifications', {
        credentials: 'include'
      });
      if (response.status === 401) {
        if (!this.previewNotifications.length) {
          preview.innerHTML = html`
            <div class="notifications-menu-item notifications-loading">
              Sign in to view notifications.
            </div>
          `;
        }
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to load notifications');
      }
      const data = await response.json();
      const notifications = Array.isArray(data.notifications)
        ? data.notifications.slice(0, 5)
        : [];

      const nextKey = notifications
        .map((notification) => `${notification.id}:${notification.acknowledged_at || ''}`)
        .join('|');
      const currentKey = this.previewNotifications
        .map((notification) => `${notification.id}:${notification.acknowledged_at || ''}`)
        .join('|');

      if (nextKey === currentKey) {
        this.previewLoadedAt = Date.now();
        return;
      }

      this.previewNotifications = notifications;
      this.previewLoadedAt = Date.now();

      if (notifications.length === 0) {
        preview.innerHTML = html`
          <div class="notifications-menu-item notifications-loading">
            No notifications yet.
          </div>
        `;
        return;
      }

      const fragment = document.createDocumentFragment();
      for (const notification of notifications) {
        const item = document.createElement('div');
        item.className = 'notification-preview-item';
        if (notification.acknowledged_at) {
          item.classList.add('is-read');
        } else {
          item.classList.add('is-new');
        }
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.addEventListener('click', () => {
          document.dispatchEvent(new CustomEvent('open-notifications', {
            detail: { notificationId: notification.id }
          }));
          this.closeNotificationsMenu();
        });

        const title = document.createElement('div');
        title.className = 'notification-preview-title';
        title.textContent = notification.title || 'Notification';

        const message = document.createElement('div');
        message.className = 'notification-preview-message';
        message.textContent = notification.message || '';

        const time = document.createElement('div');
        time.className = 'notification-preview-time';
        time.textContent = formatRelativeTime(notification.created_at) || '';
        time.title = formatDateTime(notification.created_at) || '';

        item.appendChild(title);
        item.appendChild(message);
        item.appendChild(time);
        fragment.appendChild(item);
      }
      preview.innerHTML = '';
      preview.appendChild(fragment);
    } catch {
      if (!silent && !this.previewNotifications.length) {
        preview.innerHTML = html`
          <div class="notifications-menu-item notifications-loading">
            Failed to load notifications.
          </div>
        `;
      }
    } finally {
      this.previewLoading = false;
    }
  }

  prefetchNotificationPreview() {
    const schedule = window.requestIdleCallback
      ? window.requestIdleCallback.bind(window)
      : (cb) => setTimeout(cb, 250);
    schedule(() => {
      this.loadNotificationPreview({ silent: true, force: true });
    });
  }

  handleNotificationsUpdated() {
    this.loadNotificationCount();
  }

  handleRouteChange() {
    // If we're on a server-sent page (like creation detail), don't handle route changes
    // Any navigation should result in a full page load
    const isServerSentPage = /^\/creations\/\d+$/.test(window.location.pathname) ||
      window.location.pathname.startsWith('/help/');
    if (isServerSentPage) {
      return;
    }
    
    // Get route from pathname (e.g., /feed -> feed, / -> defaultRoute)
    const pathname = window.location.pathname;
    let currentRoute = pathname === '/' || pathname === '' ? this.defaultRoute : pathname.slice(1);
    if (pathname.startsWith('/servers/')) {
      currentRoute = 'servers';
    }
    
    // If at root and we have a default route, update URL to reflect it
    if ((pathname === '/' || pathname === '') && this.defaultRoute && currentRoute) {
      window.history.replaceState({ route: currentRoute }, '', `/${currentRoute}`);
    }
    
    // Update active nav link (both desktop and mobile)
    const navLinks = this.querySelectorAll('.header-nav .nav-link, .mobile-menu .nav-link');
    navLinks.forEach(link => {
      const isActive = link.getAttribute('data-route') === currentRoute;
      link.classList.toggle('active', isActive);
    });
    
    // Update Create button state
    this.updateCreateButtonState();
    
    // Show/hide route content sections
    const contentSections = document.querySelectorAll('[data-route-content]');
    contentSections.forEach(section => {
      const isActive = section.getAttribute('data-route-content') === currentRoute;
      section.classList.toggle('active', isActive);
      section.style.display = isActive ? 'block' : 'none';
    });
    
    // Dispatch custom event for route change
    this.dispatchEvent(new CustomEvent('route-change', {
      detail: { route: currentRoute },
      bubbles: true
    }));
  }

  handleDocumentClick(e) {
    // Don't close menus if clicking inside the mobile menu
    if (this.mobileMenuOpen && this.querySelector('.mobile-menu')?.contains(e.target)) {
      return;
    }
    if (this.notificationsMenuOpen) {
      this.closeNotificationsMenu();
    }
  }

  setupEventListeners() {
    const hamburgerButton = this.querySelector('.hamburger-button');
    if (hamburgerButton) {
      hamburgerButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMobileMenu();
      });
    }

    const mobileMenuClose = this.querySelector('.mobile-menu-close');
    if (mobileMenuClose) {
      mobileMenuClose.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeMobileMenu();
      });
    }

    const mobileMenuBackdrop = this.querySelector('.mobile-menu-backdrop');
    if (mobileMenuBackdrop) {
      mobileMenuBackdrop.addEventListener('click', () => {
        this.closeMobileMenu();
      });
    }

    // Handle mobile menu navigation clicks
    const mobileNavLinks = this.querySelectorAll('.mobile-menu .nav-link');
    mobileNavLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const route = link.getAttribute('data-route');
        this.closeMobileMenu();
        if (route) {
          // Check if we're on a server-sent page (like creation detail)
          // If so, use full page navigation for ANY route change
          const isServerSentPage = /^\/creations\/\d+$/.test(window.location.pathname) ||
            window.location.pathname.startsWith('/help/');
          if (isServerSentPage) {
            // Use full page navigation for server-sent pages
            window.location.href = `/${route}`;
            return;
          }
          // Use History API with pathname-based routing for client-side pages
          window.history.pushState({ route }, '', `/${route}`);
          this.handleRouteChange();
        }
      });
    });

    // Handle mobile menu action clicks
    const mobileCreateButton = this.querySelector('.mobile-menu .create-button');
    if (mobileCreateButton) {
      mobileCreateButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (mobileCreateButton.disabled) return;
        this.closeMobileMenu();
        // Check if we're on a server-sent page (like creation detail)
        const isServerSentPage = /^\/creations\/\d+$/.test(window.location.pathname) ||
          window.location.pathname.startsWith('/help/');
        if (isServerSentPage) {
          window.location.href = '/create';
          return;
        }
        window.history.pushState({ route: 'create' }, '', '/create');
        this.handleRouteChange();
      });
    }


    const createButton = this.querySelector('.create-button');
    if (createButton) {
      createButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Don't navigate if already on create route
        if (createButton.disabled) return;
        // Check if we're on a server-sent page (like creation detail)
        const isServerSentPage = /^\/creations\/\d+$/.test(window.location.pathname);
        if (isServerSentPage) {
          window.location.href = '/create';
          return;
        }
        // Navigate to create route
        window.history.pushState({ route: 'create' }, '', '/create');
        this.handleRouteChange();
      });
    }
    const profileButton = this.querySelector('.profile-button');
    if (profileButton) {
      profileButton.addEventListener('click', (e) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('open-profile'));
      });
    }

    const notificationsButton = this.querySelector('.notifications-button');
    if (notificationsButton) {
      notificationsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleNotificationsMenu();
      });
    }

    const creditsButton = this.querySelector('.credits-button');
    if (creditsButton) {
      creditsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('open-credits'));
      });
    }

    const notificationsMenu = this.querySelector('.notifications-menu');
    if (notificationsMenu) {
      notificationsMenu.addEventListener('click', (e) => {
        const link = e.target.closest('a[data-action="notifications"]');
        if (link) {
          e.preventDefault();
          e.stopPropagation();
          this.closeNotificationsMenu();
          document.dispatchEvent(new CustomEvent('open-notifications'));
        } else {
          e.stopPropagation();
        }
      });
    }
  }

  toggleNotificationsMenu() {
    this.notificationsMenuOpen = !this.notificationsMenuOpen;
    const menu = this.querySelector('.notifications-menu');
    if (menu) {
      menu.classList.toggle('open', this.notificationsMenuOpen);
      if (this.notificationsMenuOpen) {
        this.loadNotificationPreview({ silent: true });
      }
    }
  }

  closeNotificationsMenu() {
    this.notificationsMenuOpen = false;
    const menu = this.querySelector('.notifications-menu');
    if (menu) {
      menu.classList.remove('open');
    }
  }

  toggleMobileMenu() {
    this.mobileMenuOpen = !this.mobileMenuOpen;
    const menu = this.querySelector('.mobile-menu');
    const backdrop = this.querySelector('.mobile-menu-backdrop');
    const hamburger = this.querySelector('.hamburger-button');
    if (menu) {
      menu.classList.toggle('open', this.mobileMenuOpen);
    }
    if (backdrop) {
      backdrop.classList.toggle('open', this.mobileMenuOpen);
    }
    if (hamburger) {
      hamburger.classList.toggle('active', this.mobileMenuOpen);
    }
    // Prevent body scroll when menu is open
    document.body.style.overflow = this.mobileMenuOpen ? 'hidden' : '';
  }

  closeMobileMenu() {
    this.mobileMenuOpen = false;
    const menu = this.querySelector('.mobile-menu');
    const backdrop = this.querySelector('.mobile-menu-backdrop');
    const hamburger = this.querySelector('.hamburger-button');
    if (menu) {
      menu.classList.remove('open');
    }
    if (backdrop) {
      backdrop.classList.remove('open');
    }
    if (hamburger) {
      hamburger.classList.remove('active');
    }
    document.body.style.overflow = '';
  }


  render() {
    const showNotifications = this.hasAttribute('show-notifications');
    const showProfile = this.hasAttribute('show-profile');
    const showCreate = this.hasAttribute('show-create');
    const showCredits = this.hasAttribute('show-profile');
    const hasAuthLinks = (this.authLinks || []).length > 0;

    this.innerHTML = html`
      <header>
        <div class="header-content">
          <button class="hamburger-button" aria-label="Toggle menu">
            <span></span>
            <span></span>
            <span></span>
          </button>
          <div class="header-logo">
            <a href="/" style="text-decoration: none; display: block;">
              <svg class="logo" width="200" height="40" viewBox="0 0 200 40">
                <text x="2" y="27" class="logo-text">
                  <tspan opacity="1">par</tspan><tspan opacity="0.7">asc</tspan><tspan opacity="1">ene</tspan>
                </text>
              </svg>
            </a>
          </div>
          <nav class="header-nav">
            ${(this.routes || []).map(route => {
              const routeId = route.id;
              const routeLabel = route.label;
              // Generate clean URL path (e.g., /feed, /explore)
              return html`<a href="/${routeId}" class="nav-link" data-route="${routeId}">${routeLabel}</a>`;
            }).join('')}
          </nav>
          <div class="header-actions">
            ${hasAuthLinks ? (this.authLinks || []).map(authLink => 
              html`<a href="${authLink.href}" class="header-auth-link ${authLink.isPrimary ? 'btn-primary' : ''}">${authLink.text}</a>`
            ).join('') : ''}
            ${showCreate ? html`
              <button class="action-item create-button btn-primary">
                Create
              </button>
            ` : ''}
            ${showNotifications ? html`
              <div class="notifications-wrapper">
                <button class="action-item notifications-button" aria-label="Open notifications">
                  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                  </svg>
                  <span class="notifications-badge"></span>
                </button>
                <div class="notifications-menu">
                  <div class="notifications-preview"></div>
                  <div class="notifications-menu-divider"></div>
                  <a href="#" data-action="notifications" class="notifications-menu-item">View All</a>
                </div>
                </div>
              </div>
            ` : ''}
            ${showCredits ? html`
              <button class="action-item credits-button" aria-label="Credits balance">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="9"></circle>
                  <text x="12" y="12" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="currentColor" stroke="none">P</text>
                </svg>
                <span class="credits-count">${this.creditsCount}</span>
              </button>
            ` : ''}
            ${showProfile ? html`
              <button class="action-item profile-button" aria-label="Open profile">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </button>
            ` : ''}
          </div>
        </div>
      </header>
      <div class="mobile-menu-backdrop"></div>
      <div class="mobile-menu">
        <div class="mobile-menu-header">
          <div class="header-logo">
            <a href="/" style="text-decoration: none; display: block;">
              <svg class="logo" width="200" height="40" viewBox="0 0 200 40">
                <text x="2" y="27" class="logo-text">
                  <tspan opacity="1">par</tspan><tspan opacity="0.7">asc</tspan><tspan opacity="1">ene</tspan>
                </text>
              </svg>
            </a>
          </div>
          <button class="mobile-menu-close" aria-label="Close menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="mobile-menu-content">
          <nav class="mobile-menu-nav">
            ${(this.routes || []).map(route => {
              const routeId = route.id;
              const routeLabel = route.label;
              return html`<a href="/${routeId}" class="nav-link" data-route="${routeId}">${routeLabel}</a>`;
            }).join('')}
          </nav>
          <div class="mobile-menu-actions">
            ${hasAuthLinks ? (this.authLinks || []).map(authLink => 
              html`<a href="${authLink.href}" class="header-auth-link ${authLink.isPrimary ? 'btn-primary' : ''}" style="display: block; width: 100%; text-align: center; margin-bottom: 8px;">${authLink.text}</a>`
            ).join('') : ''}
            ${showCreate ? html`
              <button class="action-item create-button btn-primary">
                Create
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('app-header', AppHeader);
