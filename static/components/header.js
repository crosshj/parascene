import { formatDateTime, formatRelativeTime } from '../shared/datetime.js';
import { fetchJsonWithStatusDeduped } from '../shared/api.js';

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
    this.handleKeydown = this.handleKeydown.bind(this);
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
    return ['show-notifications', 'hide-notifications', 'show-profile', 'show-create', 'show-mobile-menu', 'hide-credits', 'default-route', 'credits-count'];
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
    document.addEventListener('keydown', this.handleKeydown);
    window.addEventListener('popstate', this.handleRouteChange);
    document.addEventListener('notifications-acknowledged', this.handleNotificationsUpdated);
    document.addEventListener('credits-updated', this.handleCreditsUpdated);
    document.addEventListener('credits-claim-status', this.handleCreditsClaimStatus);
    this.loadNotificationCount();
    this.loadCreditsCount();
    this.updateCreditsAttention();
    this.prefetchNotificationPreview();
    // Establish current route immediately so route components can react on mount.
    this.handleRouteChange();
  }

  disconnectedCallback() {
    document.removeEventListener('click', this.handleDocumentClick);
    document.removeEventListener('keydown', this.handleKeydown);
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
    const navLinks = this.querySelectorAll('.header-nav .nav-link, .mobile-menu .nav-link');
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const route = link.getAttribute('data-route');
        if (route) {
          this.navigateToRoute(route);
          if (link.closest('.mobile-menu')) {
            this.closeMobileMenu();
          }
        }
      });
    });
  }

  navigateToRoute(route) {
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
      const result = await fetchJsonWithStatusDeduped('/api/notifications/unread-count', {
        credentials: 'include'
      }, { windowMs: 2000 });
      if (!result.ok) throw new Error('Failed to load notifications count');
      const count = Number(result.data?.count || 0);
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

    try {
      const profile = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 2000 });
      if (!profile.ok) {
        if (profile.status === 401) {
          this.clearStoredCredits();
          this.clearStoredUserEmail();
        }
        this.updateCreditsUI(0);
        return;
      }
      const user = profile.data;
      const currentUserEmail = user?.email || null;
      
      // If no signed-in user, clear cache
      if (!currentUserEmail) {
        this.clearStoredCredits();
        this.clearStoredUserEmail();
        this.updateCreditsUI(0);
        return;
      }
      
      // Check if user changed - if so, clear cache
      const cachedUserEmail = this.readStoredUserEmail();
      if (cachedUserEmail && currentUserEmail !== cachedUserEmail) {
        // User changed - clear cache
        this.clearStoredCredits();
        this.clearStoredUserEmail();
      }

      const count = this.parseCreditsCount(user?.credits);
      this.updateCreditsUI(count);
      
      // Store user email for future checks
      this.writeStoredUserEmail(currentUserEmail);
    } catch {
      // Network/unknown error fallback: show cached value (if any).
      const storedCount = this.readStoredCreditsCount();
      if (storedCount !== null && this.readStoredUserEmail()) {
        this.updateCreditsUI(storedCount);
        return;
      }
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

  readStoredUserEmail() {
    try {
      return window.localStorage?.getItem('credits-user-email');
    } catch {
      return null;
    }
  }

  writeStoredUserEmail(email) {
    try {
      window.localStorage?.setItem('credits-user-email', email);
    } catch {
      // ignore storage errors
    }
  }

  clearStoredCredits() {
    try {
      window.localStorage?.removeItem('credits-balance');
    } catch {
      // ignore storage errors
    }
  }

  clearStoredUserEmail() {
    try {
      window.localStorage?.removeItem('credits-user-email');
    } catch {
      // ignore storage errors
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
      const result = await fetchJsonWithStatusDeduped('/api/notifications', {
        credentials: 'include'
      }, { windowMs: 2000 });
      if (result.status === 401) {
        if (!this.previewNotifications.length) {
          preview.innerHTML = html`
            <div class="notifications-menu-item notifications-loading">
              Sign in to view notifications.
            </div>
          `;
        }
        return;
      }
      if (!result.ok) {
        throw new Error('Failed to load notifications');
      }
      const notifications = Array.isArray(result.data?.notifications)
        ? result.data.notifications.slice(0, 5)
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
    
    this.closeMobileMenu();

    // Get route from pathname (e.g., /feed -> feed, / -> defaultRoute)
    const pathname = window.location.pathname;
    let currentRoute = pathname === '/' || pathname === '' ? this.defaultRoute : pathname.slice(1);
    if (pathname.startsWith('/servers/')) {
      currentRoute = 'servers';
    }

    // Make current route discoverable to other components immediately on mount.
    try {
      window.__CURRENT_ROUTE__ = currentRoute;
    } catch {
      // ignore
    }
    try {
      document.documentElement.dataset.route = currentRoute;
    } catch {
      // ignore
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

    this.resetSectionScroll();
    
    // Dispatch custom event for route change
    this.dispatchEvent(new CustomEvent('route-change', {
      detail: { route: currentRoute },
      bubbles: true
    }));
  }

  handleDocumentClick(e) {
    if (this.notificationsMenuOpen) {
      this.closeNotificationsMenu();
    }
    if (this.mobileMenuOpen) {
      const menu = this.querySelector('.mobile-menu');
      const toggle = this.querySelector('[data-mobile-menu-toggle]');
      const clickedInside = menu?.contains(e.target) || toggle?.contains(e.target);
      if (!clickedInside) {
        this.closeMobileMenu();
      }
    }
  }

  handleKeydown(e) {
    if (e.key === 'Escape' && this.mobileMenuOpen) {
      this.closeMobileMenu();
    }
  }

  resetSectionScroll() {
    const scroller = document.scrollingElement || document.documentElement;
    if (!scroller) return;
    scroller.scrollTop = 0;
    if (typeof window.scrollTo === 'function') {
      window.scrollTo(0, 0);
    }
  }

  setupEventListeners() {
    const createButtons = this.querySelectorAll('.create-button');
    createButtons.forEach(createButton => {
      createButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Don't navigate if already on create route
        if (createButton.disabled) return;
        this.navigateToRoute('create');
        if (createButton.closest('.mobile-menu')) {
          this.closeMobileMenu();
        }
      });
    });

    const profileButtons = this.querySelectorAll('.profile-button');
    profileButtons.forEach(profileButton => {
      profileButton.addEventListener('click', (e) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('open-profile'));
      });
    });

    const notificationsButtons = this.querySelectorAll('.notifications-button');
    notificationsButtons.forEach(notificationsButton => {
      notificationsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleNotificationsMenu();
      });
    });

    const creditsButtons = this.querySelectorAll('.credits-button');
    creditsButtons.forEach(creditsButton => {
      creditsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('open-credits'));
      });
    });

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

    this.setupMobileMenuListeners();
  }

  setupMobileMenuListeners() {
    const toggleButton = this.querySelector('[data-mobile-menu-toggle]');
    if (toggleButton) {
      toggleButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleMobileMenu();
      });
    }

    const closeButtons = this.querySelectorAll('[data-mobile-menu-close]');
    closeButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closeMobileMenu();
      });
    });

    const backdrop = this.querySelector('[data-mobile-menu-backdrop]');
    if (backdrop) {
      backdrop.addEventListener('click', () => {
        this.closeMobileMenu();
      });
    }

    const actionButtons = this.querySelectorAll('[data-mobile-menu-action]');
    actionButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = button.getAttribute('data-mobile-menu-action');
        this.closeMobileMenu();
        if (action === 'notifications') {
          document.dispatchEvent(new CustomEvent('open-notifications'));
        } else if (action === 'credits') {
          document.dispatchEvent(new CustomEvent('open-credits'));
        } else if (action === 'profile') {
          document.dispatchEvent(new CustomEvent('open-profile'));
        } else if (action === 'create') {
          this.navigateToRoute('create');
        }
      });
    });
  }

  toggleMobileMenu() {
    this.mobileMenuOpen = !this.mobileMenuOpen;
    this.syncMobileMenuUI();
  }

  closeMobileMenu() {
    if (!this.mobileMenuOpen) return;
    this.mobileMenuOpen = false;
    this.syncMobileMenuUI();
  }

  syncMobileMenuUI() {
    const menu = this.querySelector('.mobile-menu');
    const backdrop = this.querySelector('.mobile-menu-backdrop');
    const toggle = this.querySelector('[data-mobile-menu-toggle]');
    if (menu) {
      menu.classList.toggle('open', this.mobileMenuOpen);
      menu.setAttribute('aria-hidden', this.mobileMenuOpen ? 'false' : 'true');
    }
    if (backdrop) {
      backdrop.classList.toggle('open', this.mobileMenuOpen);
    }
    if (toggle) {
      toggle.classList.toggle('active', this.mobileMenuOpen);
      toggle.setAttribute('aria-expanded', this.mobileMenuOpen ? 'true' : 'false');
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


  render() {
    const showNotifications = this.hasAttribute('show-notifications') && !this.hasAttribute('hide-notifications');
    const showProfile = this.hasAttribute('show-profile');
    const showCreate = this.hasAttribute('show-create');
    const showMobileMenu = this.hasAttribute('show-mobile-menu');
    const showCredits = this.hasAttribute('show-profile') && !this.hasAttribute('hide-credits');
    const hasAuthLinks = (this.authLinks || []).length > 0;
    const hasMobileActions = showCreate || showNotifications || showCredits || showProfile;

    this.innerHTML = html`
      <header>
        <div class="header-content">
          ${showMobileMenu ? html`
            <button
              class="hamburger-button ${this.mobileMenuOpen ? 'active' : ''}"
              data-mobile-menu-toggle
              aria-label="Open menu"
              aria-controls="mobile-menu"
              aria-expanded="${this.mobileMenuOpen ? 'true' : 'false'}"
            >
              <span></span>
              <span></span>
              <span></span>
            </button>
          ` : ''}
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
      ${showMobileMenu ? html`
        <div class="mobile-menu-backdrop ${this.mobileMenuOpen ? 'open' : ''}" data-mobile-menu-backdrop></div>
        <aside id="mobile-menu" class="mobile-menu ${this.mobileMenuOpen ? 'open' : ''}" aria-hidden="${this.mobileMenuOpen ? 'false' : 'true'}">
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
            <button class="mobile-menu-close" data-mobile-menu-close aria-label="Close menu">
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
            ${hasMobileActions ? html`
              <div class="mobile-menu-actions">
                ${showCreate ? html`
                  <button class="create-button btn-primary">
                    Create
                  </button>
                ` : ''}
                ${showNotifications ? html`
                  <button class="action-item" data-mobile-menu-action="notifications">
                    Notifications
                  </button>
                ` : ''}
                ${showCredits ? html`
                  <button class="action-item" data-mobile-menu-action="credits">
                    Credits
                  </button>
                ` : ''}
                ${showProfile ? html`
                  <button class="action-item" data-mobile-menu-action="profile">
                    Profile
                  </button>
                ` : ''}
              </div>
            ` : ''}
          </div>
        </aside>
      ` : ''}
    `;
  }
}

customElements.define('app-header', AppHeader);
