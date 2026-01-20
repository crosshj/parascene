class AppRouteCreations extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div class="creations-route">
        <div class="route-header">
          <h3>Creations</h3>
          <p>Your generated creations. Share them when you're ready.</p>
        </div>
        <div class="route-cards route-cards-image-grid" data-creations-container>
          <div class="route-empty route-empty-image-grid">Loading...</div>
        </div>
      </div>
    `;
    this.pollInterval = null;
    this.setupRouteListener();
    // Load creations after a brief delay to ensure DOM is ready
    // This also ensures we reload if navigating from another page
    setTimeout(() => {
      this.loadCreations();
      this.startPolling();
    }, 50);
  }

  setupRouteListener() {
    // Listen for route change events to reload when creations route becomes active
    this.routeChangeHandler = (e) => {
      const route = e.detail?.route;
      if (route === 'creations') {
        // Reload creations immediately when navigating to creations page
        this.loadCreations();
        // Restart polling in case it was stopped
        if (!this.pollInterval) {
          this.startPolling();
        }
      }
    };
    document.addEventListener('route-change', this.routeChangeHandler);
    
    // Also use IntersectionObserver to detect when element becomes visible
    // This catches cases where the route change event might not fire
    this.intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.target === this) {
          // Element is visible, reload creations
          this.loadCreations();
          if (!this.pollInterval) {
            this.startPolling();
          }
        }
      });
    }, {
      threshold: 0.1 // Trigger when at least 10% visible
    });
    
    this.intersectionObserver.observe(this);
  }

  disconnectedCallback() {
    this.stopPolling();
    if (this.routeChangeHandler) {
      document.removeEventListener('route-change', this.routeChangeHandler);
    }
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
  }

  getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffYears > 0) return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
    if (diffMonths > 0) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffMins > 0) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    return 'just now';
  }

  startPolling() {
    // Poll every 2 seconds for creations that are still being created
    this.pollInterval = setInterval(() => {
      this.checkForUpdates();
    }, 2000);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async checkForUpdates() {
    const container = this.querySelector("[data-creations-container]");
    if (!container) return;

    // Check if there are any loading creations
    const loadingCreations = container.querySelectorAll('.route-media[data-image-id][data-status="creating"]');
    if (loadingCreations.length === 0) {
      // No loading creations, stop polling
      this.stopPolling();
      return;
    }

      // Fetch updated creations
      try {
        const response = await fetch("/api/create/images", {
          credentials: 'include'
        });
        if (!response.ok) return;
        
        const data = await response.json();
        const creations = Array.isArray(data.images) ? data.images : [];
        
        // Update any creations that have completed
        let hasUpdates = false;
        loadingCreations.forEach(loadingElement => {
          const creationId = loadingElement.getAttribute('data-image-id');
          const updatedCreation = creations.find(c => c.id.toString() === creationId);
          
          if (updatedCreation && updatedCreation.status === 'completed') {
            hasUpdates = true;
          }
        });
        
        if (hasUpdates) {
          // Reload the entire list to get the updated creations
          this.loadCreations();
        }
    } catch (error) {
      console.error("Error checking for updates:", error);
    }
  }

  async loadCreations() {
    const container = this.querySelector("[data-creations-container]");
    if (!container) return;

    try {
      // Fetch created creations only
      const creationsResponse = await fetch("/api/create/images", {
        credentials: 'include'
      }).catch(() => ({ ok: false }));
      
      const creations = creationsResponse.ok
        ? (await creationsResponse.json()).images || []
        : [];

      container.innerHTML = "";
      
      if (creations.length === 0) {
        container.innerHTML = `
          <div class="route-empty route-empty-image-grid">
            <div class="route-empty-title">No creations yet</div>
            <div class="route-empty-message">Start creating to see your work here.</div>
            <a href="/create" class="route-empty-button" data-route="create">Get Started</a>
          </div>
        `;
        
        // Add click handler for the button to use client-side routing
        const button = container.querySelector('.route-empty-button');
        if (button) {
          button.addEventListener('click', (e) => {
            e.preventDefault();
            const header = document.querySelector('app-header');
            if (header && typeof header.handleRouteChange === 'function') {
              window.history.pushState({ route: 'create' }, '', '/create');
              header.handleRouteChange();
            } else {
              window.location.hash = 'create';
            }
          });
        }
        return;
      }

      // Sort creations by created_at (newest first)
      const sortedCreations = creations.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      for (const item of sortedCreations) {
        const card = document.createElement("div");
        card.className = "route-card route-card-image";
        
        // Created creation
        const isCreating = item.status === 'creating' || item.status === 'pending';
        
        if (isCreating) {
          // Show loading state
          card.innerHTML = `
            <div 
              class="route-media loading"
              data-image-id="${item.id}"
              data-status="creating"
              aria-hidden="true"
            ></div>
            <div class="route-details">
              <div class="route-details-content">
                <div class="route-title">Creating...</div>
                <div class="route-summary">Your creation is being processed...</div>
                <div class="route-meta">${item.created_at}</div>
              </div>
            </div>
          `;
          // Restart polling if it was stopped
          if (!this.pollInterval) {
            this.startPolling();
          }
        } else {
          // Show completed image - make it clickable
          card.style.cursor = 'pointer';
          card.addEventListener('click', () => {
            // Navigate to server route for creation detail
            window.location.href = `/creations/${item.id}`;
          });
          
          const isPublished = item.published === true || item.published === 1;
          let publishedBadge = '';
          let publishedInfo = '';
          
          if (isPublished && item.published_at) {
            const publishedDate = new Date(item.published_at);
            const publishedTimeAgo = this.getTimeAgo(publishedDate);
            
            publishedBadge = `
              <div class="creation-published-badge" title="Published">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
              </div>
            `;
            
            publishedInfo = `<div class="route-meta">Published ${publishedTimeAgo}</div>`;
          }
          
          card.innerHTML = `
            <div 
              class="route-media"
              style="background-image: url('${item.thumbnail_url || item.url}')"
              aria-hidden="true"
              data-image-id="${item.id}"
              data-status="completed"
            ></div>
            ${publishedBadge}
            <div class="route-details">
              <div class="route-details-content">
                <div class="route-title">${item.title || 'Creation'}</div>
                <div class="route-summary">${item.width} × ${item.height}px</div>
                ${publishedInfo}
                <div class="route-meta">Created ${this.getTimeAgo(new Date(item.created_at))}</div>
                <div class="route-meta route-meta-spacer"></div>
                <div class="route-tags">Color: ${item.color || 'N/A'}</div>
              </div>
            </div>
          `;
        }
        
        container.appendChild(card);
      }
    } catch (error) {
      console.error("Error loading creations:", error);
      container.innerHTML = `<div class="route-empty route-empty-image-grid">Unable to load creations.</div>`;
    }
  }
}

customElements.define("app-route-creations", AppRouteCreations);
