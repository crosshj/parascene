class AppRouteProviderGrants extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <style>
        .route-header {
          margin-bottom: 12px;
        }
        .route-header p {
          color: var(--text-muted);
        }
        .route-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 12px;
        }
        .route-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 14px;
          box-shadow: var(--shadow);
          display: grid;
          gap: 8px;
        }
        .route-title {
          font-weight: 600;
        }
        .route-meta {
          font-size: 0.85rem;
          color: var(--text-muted);
        }
        .route-empty {
          color: var(--text-muted);
        }
        .grant-status {
          text-transform: capitalize;
        }
      </style>
      <div class="route-header">
        <h3>Grants</h3>
        <p>Active funding programs and reporting milestones.</p>
      </div>
      <div class="route-cards" data-provider-grants-container>
        <div class="route-empty">Loading...</div>
      </div>
    `;
    this.loadGrants();
  }

  async loadGrants() {
    const container = this.querySelector("[data-provider-grants-container]");
    if (!container) return;

    try {
      const response = await fetch("/api/provider/grants");
      if (!response.ok) throw new Error("Failed to load provider grants.");
      const data = await response.json();
      const grants = Array.isArray(data.grants) ? data.grants : [];

      container.innerHTML = "";
      if (grants.length === 0) {
        container.innerHTML = `<div class="route-empty">No grants tracked.</div>`;
        return;
      }

      for (const grant of grants) {
        const card = document.createElement("div");
        card.className = "route-card";
        card.innerHTML = `
          <div class="route-title">${grant.name}</div>
          <div>${grant.sponsor}</div>
          <div class="route-meta">Amount • ${grant.amount}</div>
          <div class="route-meta grant-status">Status • ${grant.status}</div>
          <div class="route-meta">Next report • ${grant.next_report || "TBD"}</div>
        `;
        container.appendChild(card);
      }
    } catch (error) {
      container.innerHTML = `<div class="route-empty">Unable to load grants.</div>`;
    }
  }
}

customElements.define("app-route-provider-grants", AppRouteProviderGrants);
