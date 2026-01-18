class AppRouteCreationDetail extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div class="creation-detail-route">
        <div class="creation-detail-hero">
          <div class="creation-detail-background" data-background></div>
          <div class="creation-detail-image-wrapper">
            <img class="creation-detail-image" data-image alt="Creation" />
          </div>
        </div>
        <div class="creation-detail-footer">
          <div class="creation-detail-actions">
            <button class="creation-detail-action-btn">→ Expand</button>
            <button class="creation-detail-action-btn">⚙️ Adjust & Crop</button>
            <button class="creation-detail-action-btn">⋮ More</button>
          </div>
          <div class="creation-detail-info" data-detail-content>
            <div class="route-empty">Loading...</div>
          </div>
        </div>
      </div>
    `;
    this.setupRouteListener();
    // Small delay to ensure DOM is ready
    setTimeout(() => {
      this.handleVisibility();
      this.loadCreation();
    }, 50);
  }

  handleVisibility() {
    const creationId = this.getCreationId();
    // Only show this component if we have a valid creation ID
    if (creationId) {
      this.style.display = 'block';
      this.classList.add('is-active');
      document.body.classList.add('creation-detail-active');
      // Reset scroll to top when page becomes visible
      window.scrollTo(0, 0);
    } else {
      this.style.display = 'none';
      this.classList.remove('is-active');
      document.body.classList.remove('creation-detail-active');
    }
  }

  setupRouteListener() {
    // Listen for route change events
    this.routeChangeHandler = (e) => {
      const route = e.detail?.route;
      if (route && route.startsWith('creations')) {
        const wasVisible = this.style.display === 'block';
        this.handleVisibility();
        const isNowVisible = this.style.display === 'block';
        // Reset scroll if page just became visible
        if (!wasVisible && isNowVisible) {
          window.scrollTo(0, 0);
        }
        if (route.startsWith('creations/')) {
          this.loadCreation();
        }
      }
    };
    document.addEventListener('route-change', this.routeChangeHandler);
    
    // Listen for popstate (browser back/forward)
    this.popstateHandler = () => {
      const wasVisible = this.style.display === 'block';
      this.handleVisibility();
      const isNowVisible = this.style.display === 'block';
      // Reset scroll if page just became visible
      if (!wasVisible && isNowVisible) {
        window.scrollTo(0, 0);
      }
      this.loadCreation();
    };
    window.addEventListener('popstate', this.popstateHandler);
    
    // Also use IntersectionObserver to detect when element becomes visible
    this.intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.target === this) {
          this.handleVisibility();
          this.loadCreation();
        }
      });
    }, {
      threshold: 0.1
    });
    
    this.intersectionObserver.observe(this);
  }

  disconnectedCallback() {
    if (this.routeChangeHandler) {
      document.removeEventListener('route-change', this.routeChangeHandler);
    }
    if (this.popstateHandler) {
      window.removeEventListener('popstate', this.popstateHandler);
    }
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
  }

  getCreationId() {
    const pathname = window.location.pathname;
    const match = pathname.match(/^\/creations\/(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }

  async loadCreation() {
    const detailContent = this.querySelector('[data-detail-content]');
    const imageEl = this.querySelector('[data-image]');
    const backgroundEl = this.querySelector('[data-background]');
    
    if (!detailContent || !imageEl || !backgroundEl) return;

    const creationId = this.getCreationId();
    if (!creationId) {
      detailContent.innerHTML = `
        <div class="route-empty">
          <div class="route-empty-title">Invalid creation ID</div>
        </div>
      `;
      return;
    }

    detailContent.innerHTML = '<div class="route-empty">Loading...</div>';

    try {
      const response = await fetch(`/api/create/images/${creationId}`);
      if (!response.ok) {
        if (response.status === 404) {
          detailContent.innerHTML = `
            <div class="route-empty">
              <div class="route-empty-title">Creation not found</div>
              <div class="route-empty-message">The creation you're looking for doesn't exist or you don't have access to it.</div>
            </div>
          `;
          return;
        }
        throw new Error('Failed to load creation');
      }

      const creation = await response.json();
      
      // Set image and blurred background
      imageEl.src = creation.url;
      imageEl.style.display = 'block';
      backgroundEl.style.backgroundImage = `url('${creation.url}')`;
      
      // Format date
      const date = new Date(creation.created_at);
      const timeAgo = this.getTimeAgo(date);
      
      // Generate title from filename or use default
      const title = creation.filename 
        ? creation.filename.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ')
        : 'Creation';
      
      detailContent.innerHTML = `
        <div class="creation-detail-author">
          <span class="creation-detail-author-icon">S</span>
          <span class="creation-detail-author-name">User</span>
          <span class="creation-detail-author-handle">@user</span>
          <span class="creation-detail-date">${timeAgo}</span>
        </div>
        <div class="creation-detail-title">${title}</div>
        <div class="creation-detail-meta">
          <span>Created ${timeAgo}</span>
          <span>•</span>
          <span>0 comments</span>
          <span>•</span>
          <span>0 likes</span>
        </div>
      `;
    } catch (error) {
      console.error("Error loading creation detail:", error);
      detailContent.innerHTML = `
        <div class="route-empty">
          <div class="route-empty-title">Unable to load creation</div>
          <div class="route-empty-message">An error occurred while loading the creation.</div>
        </div>
      `;
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
}

customElements.define("app-route-creation-detail", AppRouteCreationDetail);
