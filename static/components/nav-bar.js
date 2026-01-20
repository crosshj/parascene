const html = String.raw;

class AppNavBar extends HTMLElement {
  constructor() {
    super();
    this.handleHashChange = this.handleHashChange.bind(this);
    this.routes = [];
    this.defaultRoute = null;
    this.originalChildren = [];
  }

  static get observedAttributes() {
    return ['default-route'];
  }

  connectedCallback() {
    this.parseRoutes();
    // Wait a tick for header to be ready, then render
    setTimeout(() => {
      this.render();
      this.setupEventListeners();
      this.handleHashChange();
    }, 0);
  }

  disconnectedCallback() {
    window.removeEventListener('hashchange', this.handleHashChange);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'default-route' && oldValue !== newValue) {
      this.defaultRoute = newValue;
      this.handleHashChange();
    }
  }
  
  updateHeaderNav() {
    const header = document.querySelector('app-header');
    const headerNav = header?.querySelector('.header-nav');
    if (headerNav) {
      const navItems = this.routes.map(route => {
        const routeId = route.id || route.toLowerCase().replace(/\s+/g, '-');
        const routeLabel = route.label || route;
        return html`<a href="#${routeId}" class="nav-link" data-route="${routeId}">${routeLabel}</a>`;
      }).join('');
      headerNav.innerHTML = navItems;
      this.style.display = 'none';
      // Re-setup event listeners after updating header nav
      this.setupEventListeners();
      this.handleHashChange();
      return true;
    }
    return false;
  }

  parseRoutes() {
    // Store original children
    this.originalChildren = Array.from(this.children);
    
    // Parse routes from child elements
    this.routes = this.originalChildren.map(child => {
      const routeId = child.getAttribute('data-route') || 
                     child.getAttribute('href')?.replace('#', '') ||
                     child.textContent.trim().toLowerCase().replace(/\s+/g, '-');
      const routeLabel = child.textContent.trim();
      
      return { id: routeId, label: routeLabel, element: child };
    });
    
    this.defaultRoute = this.getAttribute('default-route') || this.routes[0]?.id;
  }

  setupEventListeners() {
    window.addEventListener('hashchange', this.handleHashChange);
    
    // Handle clicks on nav links (check both in nav-bar and header)
    const header = document.querySelector('app-header');
    const headerNav = header?.querySelector('.header-nav');
    const links = headerNav ? headerNav.querySelectorAll('.nav-link') : this.querySelectorAll('.nav-link');
    
    links.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const route = link.getAttribute('data-route');
        if (route) {
          window.location.hash = route;
        }
      });
    });
  }

  handleHashChange() {
    const hash = window.location.hash.slice(1);
    const currentRoute = hash || this.defaultRoute;
    
    // Update active nav link (check both in nav-bar and header)
    const header = document.querySelector('app-header');
    const headerNav = header?.querySelector('.header-nav');
    const links = headerNav ? headerNav.querySelectorAll('.nav-link') : this.querySelectorAll('.nav-link');
    
    links.forEach(link => {
      const isActive = link.getAttribute('data-route') === currentRoute;
      link.classList.toggle('active', isActive);
    });
    
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

  render() {
    // Try to render into header's nav slot first
    if (this.updateHeaderNav()) {
      return;
    }
    
    // Otherwise render as standalone nav-bar
    const navItems = this.routes.map(route => {
      const routeId = route.id || route.toLowerCase().replace(/\s+/g, '-');
      const routeLabel = route.label || route;
      return html`<li><a href="#${routeId}" class="nav-link" data-route="${routeId}">${routeLabel}</a></li>`;
    }).join('');

    this.innerHTML = html`
      <nav class="nav-bar">
        <ul>
          ${navItems}
        </ul>
      </nav>
    `;
  }
}

customElements.define('app-nav-bar', AppNavBar);
