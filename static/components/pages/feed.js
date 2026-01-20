const html = String.raw;

class AppRouteFeed extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`
      <style>
        .feed-route .route-media:not(.route-media-has-image) {
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
        .feed-route .route-media.route-media-has-image {
          background-size: cover !important;
          background-position: center !important;
        }
      </style>
      <div class="feed-route">
        <div class="route-header">
        <h3>Feed</h3>
        <p>You will find a list of creations here based on factors like popularity, recent activity, your friends, and your interests.</p>
        </div>
        <div class="route-cards route-cards-image-grid" data-feed-container>
        <div class="route-empty route-empty-image-grid">Loading...</div>
        </div>
      </div>
    `;
    this.loadFeed();
  }

  async loadFeed() {
    const container = this.querySelector("[data-feed-container]");
    if (!container) return;

    try {
      // Get current user ID
      let currentUserId = null;
      try {
        const profileResponse = await fetch('/api/profile', {
          credentials: 'include'
        });
        if (profileResponse.ok) {
          const profile = await profileResponse.json();
          currentUserId = profile.id;
        }
      } catch (error) {
        console.error('Error fetching user profile:', error);
      }

      const response = await fetch("/api/feed", {
        credentials: 'include'
      });
      if (!response.ok) throw new Error("Failed to load feed.");
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];

      container.innerHTML = "";
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
            <div class="route-empty-title">Your feed is empty</div>
            <div class="route-empty-message">Published creations from the community will appear here. Start creating and sharing to see content in your feed.</div>
          </div>
        `;
        return;
      }

      for (const item of items) {
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
        const mediaClass = item.image_url ? 'route-media-has-image' : '';
        const mediaStyle = item.image_url 
          ? `style="background-image: url('${item.thumbnail_url || item.image_url}'); background-size: cover; background-position: center;"`
          : '';
        
        card.innerHTML = html`
          <div class="route-media ${mediaClass}" ${mediaStyle} aria-hidden="true"></div>
          ${ownedBadge}
          <div class="route-details">
            <div class="route-details-content">
              <div class="route-title">${item.title}</div>
              <div class="route-summary">${item.summary}</div>
              <div class="route-meta">${item.created_at}</div>
              <div class="route-meta">By ${item.author}</div>
              <div class="route-meta route-meta-spacer"></div>
              <div class="route-tags">${item.tags || ""}</div>
            </div>
          </div>
        `;
        container.appendChild(card);
      }
    } catch (error) {
      container.innerHTML = html`<div class="route-empty route-empty-image-grid">Unable to load feed.</div>`;
    }
  }
}

customElements.define("app-route-feed", AppRouteFeed);
