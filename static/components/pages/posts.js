class AppRoutePosts extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <style>
        .posts-route .route-header {
          margin-bottom: 12px;
        }
        .posts-route .route-header p {
          color: var(--text-muted);
        }
        .posts-route .route-cards {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 6px;
        }
        @media (max-width: 1024px) {
          .posts-route .route-cards {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }
        @media (max-width: 860px) {
          .posts-route .route-cards {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (max-width: 600px) {
          .posts-route .route-cards {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        .posts-route .route-card {
          background: transparent;
          border: none;
          border-radius: 0;
          box-shadow: none;
          position: relative;
          overflow: hidden;
          aspect-ratio: 1 / 1;
          display: flex;
          align-items: stretch;
        }
        .posts-route .route-media {
          position: absolute;
          inset: 0;
          border-radius: 6px;
          background-size: cover;
          background-position: center;
          border: none;
        }
        .posts-route .route-media.loading {
          background: var(--surface-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .posts-route .route-media.loading::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.2),
            transparent
          );
          animation: shimmer 2s infinite;
        }
        @keyframes shimmer {
          0% { left: -100%; }
          100% { left: 100%; }
        }
        .posts-route .route-media.loading::after {
          content: 'Generating...';
          position: relative;
          z-index: 1;
          color: var(--text-muted);
          font-size: 0.9rem;
        }
        .posts-route .route-details {
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
          .posts-route .route-details {
            background: rgba(255, 255, 255, 0.9);
            color: var(--text);
          }
        }
        .posts-route .route-details-content {
          padding: 12px;
        }
        .posts-route .route-card:hover .route-details,
        .posts-route .route-card:focus-within .route-details {
          opacity: 1;
          transform: translateY(0);
        }
        .posts-route .route-title {
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
        .posts-route .route-meta {
          font-size: 0.85rem;
          color: var(--text-muted);
        }
        .posts-route .route-meta-spacer {
          height: 6px;
        }
        .posts-route .route-summary {
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
          .posts-route .route-summary {
            color: rgba(15, 23, 42, 0.65);
          }
        }
        .posts-route .route-tags {
          font-size: 0.8rem;
          color: var(--text-muted);
        }
        .posts-route .route-empty {
          grid-column: 1 / -1;
          color: var(--text-muted);
        }
      </style>
      <div class="posts-route">
        <div class="route-header">
          <h3>Creations</h3>
          <p>Your generated creations. Share them when you're ready.</p>
        </div>
        <div class="route-cards" data-posts-container>
          <div class="route-empty">Loading...</div>
        </div>
      </div>
    `;
    this.pollInterval = null;
    this.setupRouteListener();
    // Load posts after a brief delay to ensure DOM is ready
    // This also ensures we reload if navigating from another page
    setTimeout(() => {
      this.loadPosts();
      this.startPolling();
    }, 50);
  }

  setupRouteListener() {
    // Listen for route change events to reload when posts route becomes active
    this.routeChangeHandler = (e) => {
      const route = e.detail?.route;
      if (route === 'posts') {
        // Reload posts immediately when navigating to posts page
        this.loadPosts();
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
          // Element is visible, reload posts
          this.loadPosts();
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
    // Poll every 2 seconds for images that are still generating
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
    const container = this.querySelector("[data-posts-container]");
    if (!container) return;

    // Check if there are any loading images
    const loadingImages = container.querySelectorAll('.route-media[data-image-id][data-status="generating"]');
    if (loadingImages.length === 0) {
      // No loading images, stop polling
      this.stopPolling();
      return;
    }

    // Fetch updated images
    try {
      const response = await fetch("/api/generate/images");
      if (!response.ok) return;
      
      const data = await response.json();
      const images = Array.isArray(data.images) ? data.images : [];
      
      // Update any images that have completed
      let hasUpdates = false;
      loadingImages.forEach(loadingElement => {
        const imageId = loadingElement.getAttribute('data-image-id');
        const updatedImage = images.find(img => img.id.toString() === imageId);
        
        if (updatedImage && updatedImage.status === 'completed') {
          hasUpdates = true;
        }
      });
      
      if (hasUpdates) {
        // Reload the entire list to get the updated images
        this.loadPosts();
      }
    } catch (error) {
      console.error("Error checking for updates:", error);
    }
  }

  async loadPosts() {
    const container = this.querySelector("[data-posts-container]");
    if (!container) return;

    try {
      // Fetch generated images only
      const imagesResponse = await fetch("/api/generate/images").catch(() => ({ ok: false }));
      
      const images = imagesResponse.ok
        ? (await imagesResponse.json()).images || []
        : [];

      container.innerHTML = "";
      
      if (images.length === 0) {
        container.innerHTML = `<div class="route-empty">No creations yet.</div>`;
        return;
      }

      // Sort images by created_at (newest first)
      const sortedImages = images.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      for (const item of sortedImages) {
        const card = document.createElement("div");
        card.className = "route-card";
        
        // Generated image
        const isGenerating = item.status === 'generating' || item.status === 'pending';
        
        if (isGenerating) {
          // Show loading state
          card.innerHTML = `
            <div 
              class="route-media loading"
              data-image-id="${item.id}"
              data-status="generating"
              aria-hidden="true"
            ></div>
            <div class="route-details">
              <div class="route-details-content">
                <div class="route-title">Generating Image</div>
                <div class="route-summary">Creating your image...</div>
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
                <div class="route-title">Generated Image</div>
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

customElements.define("app-route-posts", AppRoutePosts);
