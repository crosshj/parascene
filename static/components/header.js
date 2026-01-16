class AppHeader extends HTMLElement {
  constructor() {
    super();
    this.notificationsMenuOpen = false;
    this.mobileMenuOpen = false;
    this.handleDocumentClick = this.handleDocumentClick.bind(this);
    this.handleRouteChange = this.handleRouteChange.bind(this);
    this.routes = [];
    this.defaultRoute = null;
    this.hasParsedRoutes = false;
  }

  static get observedAttributes() {
    return ['show-notifications', 'show-profile', 'show-generate', 'default-route'];
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
    // Small delay to ensure DOM is ready for route change handler
    setTimeout(() => this.handleRouteChange(), 0);
  }

  disconnectedCallback() {
    document.removeEventListener('click', this.handleDocumentClick);
    window.removeEventListener('popstate', this.handleRouteChange);
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
    } else {
      // Re-render to update UI
      this.render();
      this.setupEventListeners();
      this.setupNavListeners();
    }
  }
  
  parseRoutesFromChildren() {
    // Parse routes from direct children - must be called BEFORE render()
    const children = Array.from(this.children);
    
    const links = children.filter(child => 
      child.tagName === 'A' && child.hasAttribute('data-route')
    );
    
    this.routes = links.map(link => ({
      id: link.getAttribute('data-route'),
      label: link.textContent.trim()
    }));
    
    if (!Array.isArray(this.routes)) {
      this.routes = [];
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
          // Use History API with pathname-based routing
          window.history.pushState({ route }, '', `/${route}`);
          this.handleRouteChange();
        }
      });
    });
  }

  updateGenerateButtonState() {
    const generateButtons = this.querySelectorAll('.generate-button');
    if (generateButtons.length === 0) return;
    
    const pathname = window.location.pathname;
    const currentRoute = pathname === '/' || pathname === '' ? this.defaultRoute : pathname.slice(1);
    const isGenerateRoute = currentRoute === 'generate';
    
    generateButtons.forEach(generateButton => {
      generateButton.disabled = isGenerateRoute;
      if (isGenerateRoute) {
        generateButton.style.background = 'var(--surface-strong)';
        generateButton.style.color = 'var(--text)';
        generateButton.style.borderColor = 'var(--border)';
        generateButton.style.cursor = 'not-allowed';
        generateButton.style.fontWeight = '700';
      } else {
        generateButton.style.background = 'var(--accent)';
        generateButton.style.color = 'var(--accent-text)';
        generateButton.style.borderColor = 'var(--accent)';
        generateButton.style.cursor = 'pointer';
        generateButton.style.fontWeight = '500';
      }
    });
  }

  handleRouteChange() {
    // Get route from pathname (e.g., /feed -> feed, / -> defaultRoute)
    const pathname = window.location.pathname;
    let currentRoute = pathname === '/' || pathname === '' ? this.defaultRoute : pathname.slice(1);
    
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
    
    // Update Generate button state
    this.updateGenerateButtonState();
    
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
          window.history.pushState({ route }, '', `/${route}`);
          this.handleRouteChange();
        }
      });
    });

    // Handle mobile menu action clicks
    const mobileGenerateButton = this.querySelector('.mobile-menu .generate-button');
    if (mobileGenerateButton) {
      mobileGenerateButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (mobileGenerateButton.disabled) return;
        this.closeMobileMenu();
        window.history.pushState({ route: 'generate' }, '', '/generate');
        this.handleRouteChange();
      });
    }


    const generateButton = this.querySelector('.generate-button');
    if (generateButton) {
      generateButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Don't navigate if already on generate route
        if (generateButton.disabled) return;
        // Navigate to generate route
        window.history.pushState({ route: 'generate' }, '', '/generate');
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
    const showGenerate = this.hasAttribute('show-generate');

    this.innerHTML = `
      <style>
        header .action-item {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 6px;
          text-decoration: none;
          color: var(--text);
          background: transparent;
          border: 1px solid transparent;
          font-size: 0.875rem;
          transition: background-color 0.2s, border-color 0.2s;
          cursor: pointer;
          font: inherit;
          align-self: center;
        }
        header .action-item:hover {
          background: var(--surface-strong);
          border-color: var(--border);
        }
        header .action-item:focus-visible {
          outline: 2px solid var(--focus);
          outline-offset: 2px;
        }
        header .action-item .icon {
          width: 16px;
          height: 16px;
          flex-shrink: 0;
          display: block;
        }
        header .header-actions > * {
          align-self: center;
        }
        header .notifications-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          box-shadow: var(--shadow);
          width: 250px;
          opacity: 0;
          visibility: hidden;
          transform: translateY(-8px);
          transition: opacity 0.2s, visibility 0.2s, transform 0.2s;
          z-index: 1000;
          overflow: hidden;
        }
        header .notifications-menu.open {
          opacity: 1;
          visibility: visible;
          transform: translateY(0);
        }
        header .notifications-menu-item {
          display: block;
          width: 100%;
          padding: 12px 16px;
          text-decoration: none;
          color: var(--text);
          border: none;
          background: transparent;
          text-align: left;
          font-size: 0.95rem;
          cursor: pointer;
          transition: background-color 0.2s;
          font: inherit;
        }
        header .notifications-menu-item:first-child {
          border-radius: 10px 10px 0 0;
        }
        header .notifications-menu-item:last-child {
          border-radius: 0 0 10px 10px;
        }
        header .notifications-menu-item:hover {
          background: var(--surface-strong);
        }
        header .notifications-menu-item:focus-visible {
          outline: 2px solid var(--focus);
          outline-offset: -2px;
        }
        header .notifications-menu-divider {
          height: 1px;
          background: var(--border);
          margin: 4px 0;
        }
        /* Hamburger button */
        header .hamburger-button {
          display: none;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          width: 24px;
          height: 24px;
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 0;
          margin-block: auto;
          margin-inline: 0;
          z-index: 1001;
          position: relative;
          gap: 4px;
          flex-shrink: 0;
        }
        header .hamburger-button span {
          width: 20px;
          height: 2px;
          background: var(--text);
          border-radius: 1px;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          transform-origin: center;
          display: block;
        }
        header .hamburger-button.active span:nth-child(1) {
          transform: rotate(45deg) translate(5px, 5px);
        }
        header .hamburger-button.active span:nth-child(2) {
          opacity: 0;
          transform: scale(0);
        }
        header .hamburger-button.active span:nth-child(3) {
          transform: rotate(-45deg) translate(5px, -5px);
        }
        /* Mobile menu overlay */
        .mobile-menu {
          position: fixed;
          top: 0;
          left: 0;
          bottom: 0;
          width: 330px;
          max-width: 85vw;
          height: 100vh;
          background: var(--surface);
          z-index: 1001;
          transform: translateX(-100%);
          transition: transform 0.3s ease;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          box-shadow: 2px 0 8px rgba(0, 0, 0, 0.15);
        }
        .mobile-menu.open {
          transform: translateX(0);
        }
        .mobile-menu-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 1000;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.3s ease, visibility 0.3s ease;
        }
        .mobile-menu-backdrop.open {
          opacity: 1;
          visibility: visible;
        }
        @media (min-width: 769px) {
          .mobile-menu {
            display: none;
          }
          .mobile-menu-backdrop {
            display: none;
          }
        }
        .mobile-menu-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 5px 0 25px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
          min-height: 57px;
        }
        .mobile-menu-header .header-logo {
          flex: 1;
          display: flex;
          align-items: center;
          line-height: 0;
          margin: 0;
          padding: 0;
        }
        .mobile-menu-header .logo {
          height: 36px;
          width: auto;
          display: block;
        }
        .mobile-menu-header .logo-text {
          font-family: "Montserrat", "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 24px;
          font-weight: 700;
          font-style: italic;
          fill: var(--text);
          letter-spacing: -0.02em;
        }
        .mobile-menu-close {
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 6px;
          color: var(--text);
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          transition: background-color 0.2s;
          margin: auto;
        }
        .mobile-menu-close:hover {
          background: var(--surface-strong);
        }
        .mobile-menu-close svg {
          width: 25px;
          height: 25px;
        }
        .mobile-menu-content {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .mobile-menu-nav {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-bottom: 20px;
        }
        .mobile-menu-nav .nav-link {
          display: block;
          padding: 14px 16px;
          text-decoration: none;
          color: var(--text-muted);
          font-size: 0.95rem;
          font-weight: 500;
          border-radius: 8px;
          transition: background-color 0.2s, color 0.2s;
        }
        .mobile-menu-nav .nav-link:hover {
          background: var(--surface-strong);
          color: var(--text);
        }
        .mobile-menu-nav .nav-link.active {
          color: var(--text);
          font-weight: 600;
          background: var(--surface-strong);
        }
        .mobile-menu-actions {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-top: 20px;
        }
        .mobile-menu-actions .generate-button {
          width: 100%;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 0.95rem;
          font-weight: 600;
        }
        .mobile-menu-actions .action-item {
          display: block;
          width: 100%;
          padding: 14px 16px;
          text-decoration: none;
          color: var(--text-muted);
          font-size: 0.95rem;
          font-weight: 500;
          border-radius: 8px;
          transition: background-color 0.2s, color 0.2s;
          border: none;
          background: transparent;
          text-align: left;
          cursor: pointer;
          font: inherit;
        }
        .mobile-menu-actions .action-item:hover {
          background: var(--surface-strong);
          color: var(--text);
        }
        .mobile-menu-profile {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .mobile-menu-profile-item {
          display: block;
          padding: 14px 16px;
          text-decoration: none;
          color: var(--text-muted);
          border-radius: 8px;
          background: transparent;
          text-align: left;
          font-size: 0.95rem;
          font-weight: 500;
          transition: background-color 0.2s, color 0.2s;
          border: none;
          cursor: pointer;
          font: inherit;
        }
        .mobile-menu-profile-item:hover {
          background: var(--surface-strong);
          color: var(--text);
        }
        .mobile-menu-profile button[type="submit"].mobile-menu-profile-item {
          background: var(--surface-strong);
          color: var(--text);
          text-align: center;
          margin-top: 8px;
        }
        .mobile-menu-profile button[type="submit"].mobile-menu-profile-item:hover {
          background: var(--border);
        }
        /* Mobile responsive styles */
        @media (max-width: 768px) {
          header .hamburger-button,
          header .action-item,
          header .header-nav a,
          .mobile-menu .nav-link,
          .mobile-menu .action-item,
          .mobile-menu-close {
            -webkit-tap-highlight-color: transparent;
          }
          header .hamburger-button {
            display: flex;
            margin-right: 12px;
            margin-left: 0;
            flex-shrink: 0;
          }
          header .header-nav {
            display: none;
          }
          header .header-actions {
            display: flex;
            gap: 4px;
          }
          header .header-actions .generate-button {
            display: none;
          }
          header .header-content {
            padding: 0 16px;
            gap: 0;
            align-items: center;
            min-height: 48px;
          }
          header .header-logo {
            margin: 0;
            height: 36px;
            display: flex;
            align-items: center;
          }
          header .header-logo .logo {
            height: 36px;
            width: auto;
          }
          header .header-actions {
            margin-left: auto;
          }
        }
        @media (min-width: 769px) {
          header .hamburger-button {
            display: none;
          }
        }
      </style>
      <header>
        <div class="header-content">
          <button class="hamburger-button" aria-label="Toggle menu">
            <span></span>
            <span></span>
            <span></span>
          </button>
          <div class="header-logo">
            <svg class="logo" width="200" height="40" viewBox="0 0 200 40">
              <text x="2" y="27" class="logo-text">
                <tspan opacity="1">par</tspan><tspan opacity="0.7">asc</tspan><tspan opacity="1">ene</tspan>
              </text>
            </svg>
          </div>
          <nav class="header-nav">
            ${(this.routes || []).map(route => {
              const routeId = route.id;
              const routeLabel = route.label;
              // Generate clean URL path (e.g., /feed, /explore)
              return `<a href="/${routeId}" class="nav-link" data-route="${routeId}">${routeLabel}</a>`;
            }).join('')}
          </nav>
          <div class="header-actions">
            ${showGenerate ? `
              <button class="action-item generate-button" style="background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 500;">
                Generate
              </button>
            ` : ''}
            ${showNotifications ? `
              <div style="position: relative;">
                <button class="action-item notifications-button">
                  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                  </svg>
                </button>
                <div class="notifications-menu">
                  <div class="notifications-menu-item" style="color: var(--text-muted); cursor: default;">
                    No new notifications
                  </div>
                  <div class="notifications-menu-divider"></div>
                  <a href="#" data-action="notifications" class="notifications-menu-item">View All</a>
                </div>
              </div>
            ` : ''}
            ${showProfile ? `
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
            <svg class="logo" width="200" height="40" viewBox="0 0 200 40">
              <text x="2" y="27" class="logo-text">
                <tspan opacity="1">par</tspan><tspan opacity="0.7">asc</tspan><tspan opacity="1">ene</tspan>
              </text>
            </svg>
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
              return `<a href="/${routeId}" class="nav-link" data-route="${routeId}">${routeLabel}</a>`;
            }).join('')}
          </nav>
          <div class="mobile-menu-actions">
            ${showGenerate ? `
              <button class="action-item generate-button" style="background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 500;">
                Generate
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('app-header', AppHeader);
