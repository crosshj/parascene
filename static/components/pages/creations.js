class AppRouteCreations extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <style>
        .creations-route .route-header {
          margin-bottom: 12px;
        }
        .creations-route .route-header p {
          color: var(--text-muted);
        }
        .creations-route .route-cards {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 6px;
        }
        @media (max-width: 1024px) {
          .creations-route .route-cards {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }
        @media (max-width: 860px) {
          .creations-route .route-cards {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (max-width: 600px) {
          .creations-route .route-cards {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        .creations-route .route-card {
          background: transparent;
          border: none;
          border-radius: 0;
          box-shadow: none;
          position: relative;
          overflow: hidden;
          aspect-ratio: 1 / 1;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: stretch;
        }
        .creations-route .route-media {
          position: absolute;
          inset: 0;
          border-radius: 6px;
          background-size: cover;
          background-position: center;
          border: none;
        }
        .creations-route .route-media.loading {
          background: linear-gradient(90deg, var(--surface-muted), var(--surface-strong), var(--surface-muted));
          background-size: 200% 100%;
          animation: loading 4s linear infinite;
          display: flex;
          align-items: center;
          justify-content: center;
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }
        @keyframes loading {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
        .creations-route .route-media.loading::after {
          content: 'Creating...';
          position: relative;
          z-index: 1;
          color: var(--text-muted);
          font-size: 0.9rem;
        }
        .creations-route .route-details {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          width: 100%;
          background: rgba(15, 13, 26, 0.92);
          opacity: 0;
          transform: translateY(6px);
          transition: opacity 0.2s ease, transform 0.2s ease;
          color: var(--text);
        }
        @media (prefers-color-scheme: light) {
          .creations-route .route-details {
            background: rgba(255, 255, 255, 0.9);
            color: var(--text);
          }
        }
        .creations-route .route-details-content {
          padding: 12px;
        }
        .creations-route .route-card:hover .route-details,
        .creations-route .route-card:focus-within .route-details {
          opacity: 1;
          transform: translateY(0);
        }
        .creations-route .route-title {
          font-weight: 600;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          line-height: 1.2;
          max-height: calc(1.2em * 2);
          height: calc(1.2em * 2);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .creations-route .route-meta {
          font-size: 0.85rem;
          color: var(--text-muted);
        }
        .creations-route .route-meta-spacer {
          height: 6px;
        }
        .creations-route .route-summary {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          line-height: 1.3;
          max-height: calc(1.3em * 2);
          height: calc(1.3em * 2);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
          font-size: 0.85rem;
          color: rgba(237, 233, 254, 0.7);
          margin-top: 0;
        }
        @media (prefers-color-scheme: light) {
          .creations-route .route-summary {
            color: rgba(15, 23, 42, 0.65);
          }
        }
        .creations-route .route-tags {
          font-size: 0.8rem;
          color: var(--text-muted);
        }
        .creations-route .route-empty {
          grid-column: 1 / -1;
          text-align: center;
          padding: 48px 24px;
          color: var(--text-muted);
        }
        .creations-route .route-empty-title {
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--text);
          margin-bottom: 8px;
        }
        .creations-route .route-empty-message {
          font-size: 0.95rem;
          color: var(--text-muted);
          margin-bottom: 24px;
          line-height: 1.5;
        }
        .creations-route .route-empty-button {
          display: inline-block;
          padding: 10px 24px;
          background: var(--accent);
          color: var(--accent-text);
          border: none;
          border-radius: 6px;
          font-size: 0.95rem;
          font-weight: 500;
          cursor: pointer;
          text-decoration: none;
          transition: background 0.2s ease, transform 0.1s ease;
        }
        .creations-route .route-empty-button:hover {
          background: var(--focus);
          transform: translateY(-1px);
        }
        .creations-route .route-empty-button:active {
          transform: translateY(0);
        }
      </style>
      <div class="creations-route">
        <div class="route-header">
          <h3>Creations</h3>
          <p>Your generated creations. Share them when you're ready.</p>
        </div>
        <div class="route-cards" data-creations-container>
          <div class="route-empty">Loading...</div>
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
        const response = await fetch("/api/create/images");
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
      const creationsResponse = await fetch("/api/create/images").catch(() => ({ ok: false }));
      
      const creations = creationsResponse.ok
        ? (await creationsResponse.json()).images || []
        : [];

      container.innerHTML = "";
      
      if (creations.length === 0) {
        container.innerHTML = `
          <div class="route-empty">
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
        card.className = "route-card";
        
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
          // Show completed image
          card.innerHTML = `
            <div 
              class="route-media"
              style="background-image: url('${item.url}')"
              aria-hidden="true"
              data-image-id="${item.id}"
              data-status="completed"
            ></div>
            <div class="route-details">
              <div class="route-details-content">
                <div class="route-title">Creation</div>
                <div class="route-summary">${item.width} × ${item.height}px</div>
                <div class="route-meta">${item.created_at}</div>
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
      container.innerHTML = `<div class="route-empty">Unable to load creations.</div>`;
    }
  }
}

customElements.define("app-route-creations", AppRouteCreations);
