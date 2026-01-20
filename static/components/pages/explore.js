const html = String.raw;

class AppRouteExplore extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`
      <div class="route-header">
        <h3>Explore</h3>
        <p>You will find a list of creations here based on factors that are outside you current configuration.</p>
      </div>
      <div class="route-cards cards-grid-auto" data-explore-container>
        <div class="route-empty">Loading...</div>
      </div>
    `;
    this.loadExplore();
  }

  async loadExplore() {
    const container = this.querySelector("[data-explore-container]");
    if (!container) return;

    try {
      const response = await fetch("/api/explore", {
        credentials: 'include'
      });
      if (!response.ok) throw new Error("Failed to load explore.");
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];

      container.innerHTML = "";
      if (items.length === 0) {
        container.innerHTML = html`<div class="route-empty">No explore items yet.</div>`;
        return;
      }

      for (const item of items) {
        const card = document.createElement("div");
        card.className = "route-card";
        card.innerHTML = html`
          <div class="route-title">${item.title}</div>
          <div>${item.summary}</div>
          <div class="route-meta">${item.category} • ${item.created_at}</div>
        `;
        container.appendChild(card);
      }
    } catch (error) {
      container.innerHTML = html`<div class="route-empty">Unable to load explore.</div>`;
    }
  }
}

customElements.define("app-route-explore", AppRouteExplore);
