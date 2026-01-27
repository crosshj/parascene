const html = String.raw;

class AppNavigationMobile extends HTMLElement {
	constructor() {
		super();
		this.handleNavClick = this.handleNavClick.bind(this);
		this.handleRouteChange = this.handleRouteChange.bind(this);
	}

	connectedCallback() {
		this.render();
		this.setupEventListeners();
		window.addEventListener('popstate', this.handleRouteChange);
		document.addEventListener('route-change', this.handleRouteChange);
		setTimeout(() => this.handleRouteChange(), 0);
	}

	disconnectedCallback() {
		window.removeEventListener('popstate', this.handleRouteChange);
		document.removeEventListener('route-change', this.handleRouteChange);
	}

	setupEventListeners() {
		const navButtons = this.querySelectorAll('.mobile-bottom-nav-item[data-route]');
		navButtons.forEach(button => {
			button.addEventListener('click', this.handleNavClick);
		});
	}

	handleNavClick(event) {
		event.preventDefault();
		event.stopPropagation();
		const button = event.currentTarget;
		if (button?.disabled) return;
		const route = button?.getAttribute('data-route');
		if (!route) return;

		const isServerSentPage = /^\/creations\/\d+$/.test(window.location.pathname) ||
			window.location.pathname.startsWith('/help/') ||
			window.location.pathname === '/user' ||
			/^\/user\/\d+$/.test(window.location.pathname);
		if (isServerSentPage) {
			window.location.href = `/${route}`;
			return;
		}

		window.history.pushState({ route }, '', `/${route}`);
		const header = document.querySelector('app-navigation');
		if (header && typeof header.handleRouteChange === 'function') {
			header.handleRouteChange();
		} else {
			this.updateContentForRoute(route);
		}
		this.handleRouteChange();
		this.resetSectionScroll();
	}

	updateContentForRoute(route) {
		const contentSections = document.querySelectorAll('[data-route-content]');
		contentSections.forEach(section => {
			const isActive = section.getAttribute('data-route-content') === route;
			section.classList.toggle('active', isActive);
			section.style.display = isActive ? 'block' : 'none';
		});
	}

	resetSectionScroll() {
		const scroller = document.scrollingElement || document.documentElement;
		if (!scroller) return;
		scroller.scrollTop = 0;
		if (typeof window.scrollTo === 'function') {
			window.scrollTo(0, 0);
		}
	}

	handleRouteChange() {
		const navButtons = this.querySelectorAll('.mobile-bottom-nav-item[data-route]');
		if (navButtons.length === 0) return;
		const pathname = window.location.pathname;
		const header = document.querySelector('app-navigation');
		const defaultRoute = header?.getAttribute('default-route') || 'feed';
		let currentRoute = pathname === '/' || pathname === '' ? defaultRoute : pathname.slice(1);
		if (pathname.startsWith('/creations/')) {
			currentRoute = null;
		}
		if (pathname === '/user' || /^\/user\/\d+$/.test(pathname)) {
			currentRoute = null;
		}
		navButtons.forEach(button => {
			const route = button.getAttribute('data-route');
			const isActive = Boolean(currentRoute) && route === currentRoute;
			button.classList.toggle('is-active', isActive);
			if (button.classList.contains('create-button')) {
				button.disabled = false;
			}
		});
	}

	render() {
		this.innerHTML = html`
      <div class="mobile-bottom-nav-wrap" aria-label="Mobile actions">
        <div class="mobile-bottom-nav-bar" aria-hidden="true"></div>
        <div class="mobile-bottom-nav-buttons" role="navigation" aria-label="Mobile actions">
          <button class="mobile-bottom-nav-item" data-route="feed" aria-label="Home">
			<svg class="mobile-bottom-nav-icon mobile-bottom-nav-icon-home" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path class="home-house" d="M 3 9 L 12 2 L 21 9 L 21 20 C 21 21.105 20.105 22 19 22 L 15 22 L 15 12 L 9 12 L 9 22 L 5 22 C 3.895 22 3 21.105 3 20 Z"></path>
			</svg>
            <span class="mobile-bottom-nav-text" aria-hidden="true">Home</span>
          </button>
          <button class="mobile-bottom-nav-item" data-route="creations" aria-label="Creations">
            <svg class="mobile-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2"></rect>
              <circle cx="8" cy="10" r="2"></circle>
              <path d="M21 17l-5-5L5 19"></path>
            </svg>
            <span class="mobile-bottom-nav-text" aria-hidden="true">Creations</span>
          </button>
		  <button class="mobile-bottom-nav-item create-button" data-route="create" aria-label="Create">
            <span class="create-button-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </span>
            <span class="mobile-bottom-nav-text" aria-hidden="true">Create</span>
          </button>
          <button class="mobile-bottom-nav-item" data-route="explore" aria-label="Explore">
            <svg class="mobile-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
            <span class="mobile-bottom-nav-text" aria-hidden="true">Explore</span>
          </button>
          <button class="mobile-bottom-nav-item" data-route="servers" aria-label="Servers">
            <svg class="mobile-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="6" rx="2"></rect>
              <rect x="3" y="14" width="18" height="6" rx="2"></rect>
              <path d="M7 7h.01"></path>
              <path d="M7 17h.01"></path>
            </svg>
            <span class="mobile-bottom-nav-text" aria-hidden="true">Servers</span>
          </button>
        </div>
      </div>
    `;
	}
}

customElements.define('app-navigation-mobile', AppNavigationMobile);
