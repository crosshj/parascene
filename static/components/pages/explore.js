import { formatDateTime, formatRelativeTime } from '../../shared/datetime.js';
import { fetchJsonWithStatusDeduped } from '../../shared/api.js';

const html = String.raw;

function setRouteMediaBackgroundImage(mediaEl, url) {
  if (!mediaEl || !url) return;

  // Start in "no-image" state so placeholders show until load completes
  mediaEl.classList.remove('route-media-has-image');
  mediaEl.classList.remove('route-media-error');
  mediaEl.style.backgroundImage = '';

  return new Promise((resolve) => {
    const probe = new Image();
    probe.decoding = 'async';
    probe.onload = () => {
      mediaEl.classList.remove('route-media-error');
      mediaEl.classList.add('route-media-has-image');
      mediaEl.style.backgroundImage = `url("${String(url).replace(/"/g, '\\"')}")`;
      resolve(true);
    };
    probe.onerror = () => {
      mediaEl.classList.remove('route-media-has-image');
      mediaEl.classList.add('route-media-error');
      mediaEl.style.backgroundImage = '';
      resolve(false);
    };
    probe.src = url;
  });
}

class AppRouteExplore extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`
      <style>
        .explore-route .route-media:not(.route-media-has-image) {
          background:
            linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(5, 199, 111, 0.2)),
            repeating-linear-gradient(
              45deg,
              rgba(255, 255, 255, 0.06) 0,
              rgba(255, 255, 255, 0.06) 6px,
              rgba(255, 255, 255, 0.02) 6px,
              rgba(255, 255, 255, 0.02) 12px
            );
        }
        .explore-route .route-media.route-media-has-image {
          background-size: cover !important;
          background-position: center !important;
        }
      </style>
      <div class="explore-route">
        <div class="route-header">
        <h3>Explore</h3>
        <p>Discover creations from the broader community, including people you are not friends with yet.</p>
        </div>
        <div class="route-cards route-cards-image-grid" data-explore-container>
        <div class="route-empty route-empty-image-grid route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>
        </div>
      </div>
    `;
    this.setupImageLazyLoading();
    this.loadExplore();
  }

  setupImageLazyLoading() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const prefersSaveData = Boolean(connection && connection.saveData);
    const isVerySlowConnection = Boolean(connection && typeof connection.effectiveType === 'string' && connection.effectiveType.includes('2g'));

    this.eagerImageCount = prefersSaveData || isVerySlowConnection ? 2 : 6;
    this.maxConcurrentImageLoads = prefersSaveData || isVerySlowConnection ? 2 : 4;
    this.imageRootMargin = prefersSaveData || isVerySlowConnection ? '200px 0px' : '600px 0px';

    this.imageLoadQueue = [];
    this.imageLoadsInFlight = 0;

    // (Re)create observer
    if (this.imageObserver) this.imageObserver.disconnect();
    this.imageObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const el = entry.target;
        if (!el || el.dataset.bgQueued === '1') return;

        const url = el.dataset.bgUrl;
        if (!url) {
          this.imageObserver.unobserve(el);
          return;
        }

        el.dataset.bgQueued = '1';
        this.imageObserver.unobserve(el);
        this.imageLoadQueue.push({ el, url });
        this.drainImageLoadQueue();
      });
    }, {
      root: null,
      rootMargin: this.imageRootMargin,
      threshold: 0.01,
    });
  }

  drainImageLoadQueue() {
    if (!Array.isArray(this.imageLoadQueue)) return;
    if (typeof this.maxConcurrentImageLoads !== 'number' || this.maxConcurrentImageLoads <= 0) return;

    while (this.imageLoadsInFlight < this.maxConcurrentImageLoads && this.imageLoadQueue.length > 0) {
      const next = this.imageLoadQueue.shift();
      if (!next || !next.el || !next.url) continue;

      this.imageLoadsInFlight += 1;
      Promise.resolve(setRouteMediaBackgroundImage(next.el, next.url))
        .finally(() => {
          this.imageLoadsInFlight -= 1;
          this.drainImageLoadQueue();
        });
    }
  }

  disconnectedCallback() {
    if (this.imageObserver) {
      this.imageObserver.disconnect();
      this.imageObserver = null;
    }
    this.imageLoadQueue = [];
    this.imageLoadsInFlight = 0;
  }

  async loadExplore() {
    const container = this.querySelector("[data-explore-container]");
    if (!container) return;

    try {
      // Get current user ID
      let currentUserId = null;
      const profile = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 2000 })
        .catch(() => ({ ok: false, status: 0, data: null }));
      if (profile.ok) {
        currentUserId = profile.data?.id ?? null;
      }

      const feed = await fetchJsonWithStatusDeduped("/api/feed", {
        credentials: 'include'
      }, { windowMs: 2000 });
      if (!feed.ok) throw new Error("Failed to load explore.");
      const items = Array.isArray(feed.data?.items) ? feed.data.items : [];

      container.innerHTML = "";
      // New content means new media elements; clear previous observers/queue.
      if (this.imageObserver) this.imageObserver.disconnect();
      this.imageLoadQueue = [];
      this.imageLoadsInFlight = 0;
      this.setupImageLazyLoading();

      if (items.length === 0) {
        container.innerHTML = html`
          <div class="route-empty route-empty-image-grid feed-empty-state">
            <div class="feed-empty-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
              </svg>
            </div>
            <div class="route-empty-title">Your explore feed is empty</div>
            <div class="route-empty-message">Published creations from the community will appear here. Start creating and sharing to see content in your explore feed.</div>
          </div>
        `;
        return;
      }

      items.forEach((item, index) => {
        const card = document.createElement("div");
        card.className = "route-card route-card-image";
        
        // If item has an image, make it clickable and use the image
        if (item.image_url && item.created_image_id) {
          card.style.cursor = 'pointer';
          card.addEventListener('click', () => {
            window.location.href = `/creations/${item.created_image_id}`;
          });
        }
        
        // Check if current user owns this item
        const isOwned = currentUserId && item.user_id && currentUserId === item.user_id;
        const ownedBadge = isOwned ? html`
          <div class="creation-published-badge" title="Your creation">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </div>
        ` : '';
        
        // Add class to indicate if there's an image (to override gradient)
        const mediaClass = item.image_url ? '' : '';
        
        card.innerHTML = html`
          <div class="route-media ${mediaClass}" aria-hidden="true"></div>
          ${ownedBadge}
          <div class="route-details">
            <div class="route-details-content">
              <div class="route-title">${item.title}</div>
              <div class="route-summary">${item.summary}</div>
              <div class="route-meta" title="${formatDateTime(item.created_at)}">${formatRelativeTime(item.created_at)}</div>
              <div class="route-meta">By ${item.author}</div>
              <div class="route-meta route-meta-spacer"></div>
              <div class="route-tags">${item.tags || ""}</div>
            </div>
          </div>
        `;

        // Apply image background with proper load/error handling
        if (item.image_url) {
          const mediaEl = card.querySelector('.route-media');
          const url = item.thumbnail_url || item.image_url;
          if (index < this.eagerImageCount) {
            setRouteMediaBackgroundImage(mediaEl, url);
          } else if (this.imageObserver && mediaEl) {
            mediaEl.dataset.bgUrl = url;
            mediaEl.dataset.bgQueued = '0';
            this.imageObserver.observe(mediaEl);
          }
        }
        container.appendChild(card);
      });
    } catch (error) {
      container.innerHTML = html`<div class="route-empty route-empty-image-grid">Unable to load explore.</div>`;
    }
  }
}

customElements.define("app-route-explore", AppRouteExplore);
