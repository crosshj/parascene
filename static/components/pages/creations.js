import { formatDateTime, formatRelativeTime } from '../../shared/datetime.js';

const html = String.raw;

function setRouteMediaBackgroundImage(mediaEl, url) {
  if (!mediaEl || !url) return;

  mediaEl.classList.remove('route-media-error');
  mediaEl.style.backgroundImage = '';

  const probe = new Image();
  probe.decoding = 'async';
  probe.onload = () => {
    mediaEl.classList.remove('route-media-error');
    mediaEl.style.backgroundImage = `url("${String(url).replace(/"/g, '\\"')}")`;
  };
  probe.onerror = () => {
    mediaEl.classList.add('route-media-error');
    mediaEl.style.backgroundImage = '';
  };
  probe.src = url;
}

class AppRouteCreations extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`
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
    this.hasLoadedOnce = false;
    this.isLoading = false;
    this.setupRouteListener();
    this.pendingUpdateHandler = () => {
      this.loadCreations({ force: true });
    };
    document.addEventListener('creations-pending-updated', this.pendingUpdateHandler);
    // Load creations after a brief delay to ensure DOM is ready
    // This also ensures we reload if navigating from another page
    setTimeout(() => {
      this.loadCreations({ force: true });
      this.startPolling();
    }, 50);
  }

  setupRouteListener() {
    // Listen for route change events to reload when creations route becomes active
    this.routeChangeHandler = (e) => {
      const route = e.detail?.route;
      if (route === 'creations') {
        // Only refresh if stale or needed to avoid flicker
        this.refreshOnActivate();
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
          // Element is visible, refresh if needed
          this.refreshOnActivate();
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
    if (this.pendingUpdateHandler) {
      document.removeEventListener('creations-pending-updated', this.pendingUpdateHandler);
    }
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
  }

  getPendingCreations() {
    const pending = JSON.parse(sessionStorage.getItem("pendingCreations") || "[]");
    return Array.isArray(pending) ? pending : [];
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

  refreshOnActivate() {
    const hasPending = this.getPendingCreations().length > 0;
    const hasLoading = this.querySelectorAll('.route-media[data-image-id][data-status="creating"]').length > 0;

    if (!this.hasLoadedOnce || hasPending || hasLoading) {
      this.loadCreations({ force: true });
    }
  }

  async loadCreations({ force = false } = {}) {
    const container = this.querySelector("[data-creations-container]");
    if (!container) return;
    if (this.isLoading) return;
    if (!force && this.hasLoadedOnce) return;

    try {
      this.isLoading = true;
      // Fetch created creations only
      const creationsResponse = await fetch("/api/create/images", {
        credentials: 'include'
      }).catch(() => ({ ok: false }));
      
      const creations = creationsResponse.ok
        ? (await creationsResponse.json()).images || []
        : [];

      container.innerHTML = "";
      const pendingCreations = this.getPendingCreations();
      const combinedCreations = [...pendingCreations, ...creations];
      
      if (combinedCreations.length === 0) {
        container.innerHTML = html`
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
        this.hasLoadedOnce = true;
        return;
      }

      // Sort creations by created_at (newest first)
      const sortedCreations = combinedCreations.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      for (const item of sortedCreations) {
        const card = document.createElement("div");
        card.className = "route-card route-card-image";
        
        // Created creation
        const isCreating = item.status === 'creating' || item.status === 'pending';
        
        if (isCreating) {
          // Show loading state
          card.innerHTML = html`
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
                <div class="route-meta" title="${formatDateTime(item.created_at)}">${formatRelativeTime(item.created_at)}</div>
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
            const publishedTimeAgo = formatRelativeTime(publishedDate);
            
            publishedBadge = html`
              <div class="creation-published-badge" title="Published">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
              </div>
            `;
            
            publishedInfo = html`<div class="route-meta" title="${formatDateTime(item.published_at)}">Published ${publishedTimeAgo}</div>`;
          }
          
          card.innerHTML = html`
            <div 
              class="route-media"
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
                <div class="route-meta" title="${formatDateTime(item.created_at)}">Created ${formatRelativeTime(item.created_at)}</div>
                <div class="route-meta route-meta-spacer"></div>
                <div class="route-tags">Color: ${item.color || 'N/A'}</div>
              </div>
            </div>
          `;

          const mediaEl = card.querySelector('.route-media');
          const url = item.thumbnail_url || item.url;
          setRouteMediaBackgroundImage(mediaEl, url);
        }
        
        container.appendChild(card);
      }
      this.hasLoadedOnce = true;
    } catch (error) {
      console.error("Error loading creations:", error);
      container.innerHTML = html`
        <div class="route-empty route-empty-image-grid">Unable to load creations.</div>
      `;
    } finally {
      this.isLoading = false;
    }
  }
}

customElements.define("app-route-creations", AppRouteCreations);
