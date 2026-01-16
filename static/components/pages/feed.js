class AppRouteFeed extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <style>
        .feed-route .route-header {
          margin-bottom: 12px;
        }
        .feed-route .route-header p {
          color: var(--text-muted);
        }
        .feed-route .route-cards {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 6px;
        }
        @media (max-width: 1024px) {
          .feed-route .route-cards {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }
        @media (max-width: 860px) {
          .feed-route .route-cards {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (max-width: 600px) {
          .feed-route .route-cards {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        .feed-route .route-card {
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
        .feed-route .route-media {
          position: absolute;
          inset: 0;
          border-radius: 6px;
          background:
            linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(5, 199, 111, 0.2)),
            repeating-linear-gradient(
              45deg,
              rgba(255, 255, 255, 0.06) 0,
              rgba(255, 255, 255, 0.06) 6px,
              rgba(255, 255, 255, 0.02) 6px,
              rgba(255, 255, 255, 0.02) 12px
            );
          background-size: cover;
          border: none;
        }
        .feed-route .route-details {
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
          .feed-route .route-details {
            background: rgba(255, 255, 255, 0.9);
            color: var(--text);
          }
        }
        .feed-route .route-details-content {
          padding: 12px;
        }
        .feed-route .route-card:hover .route-details,
        .feed-route .route-card:focus-within .route-details {
          opacity: 1;
          transform: translateY(0);
        }
        .feed-route .route-title {
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
        .feed-route .route-meta {
          font-size: 0.85rem;
          color: var(--text-muted);
        }
        .feed-route .route-meta-spacer {
          height: 6px;
        }
        .feed-route .route-summary {
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
          .feed-route .route-summary {
            color: rgba(15, 23, 42, 0.65);
          }
        }
        .feed-route .route-tags {
          font-size: 0.8rem;
          color: var(--text-muted);
        }
        .feed-route .route-empty {
          color: var(--text-muted);
        }
      </style>
      <div class="feed-route">
        <div class="route-header">
        <h3>Feed</h3>
        <p>You will find a list of creations here based on factors like popularity, recent activity, your friends, and your interests.</p>
        </div>
        <div class="route-cards" data-feed-container>
        <div class="route-empty">Loading...</div>
        </div>
      </div>
    `;
    this.loadFeed();
  }

  async loadFeed() {
    const container = this.querySelector("[data-feed-container]");
    if (!container) return;

    try {
      const response = await fetch("/api/feed");
      if (!response.ok) throw new Error("Failed to load feed.");
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];

      container.innerHTML = "";
      if (items.length === 0) {
        container.innerHTML = `<div class="route-empty">No feed items yet.</div>`;
        return;
      }

      for (const item of items) {
        const card = document.createElement("div");
        card.className = "route-card";
        card.innerHTML = `
          <div class="route-media" aria-hidden="true"></div>
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
      container.innerHTML = `<div class="route-empty">Unable to load feed.</div>`;
    }
  }
}

customElements.define("app-route-feed", AppRouteFeed);
