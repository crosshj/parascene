const html = String.raw;

class AppRouteProviderGrants extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`
      <style>
        .grant-status {
          text-transform: capitalize;
        }
      </style>
      <div class="route-header">
        <h3>Grants</h3>
        <p>Active funding programs and reporting milestones.</p>
      </div>
      <div class="route-cards grid-auto-fit" data-provider-grants-container>
        <div class="route-empty">Loading...</div>
      </div>
    `;
    this.loadGrants();
  }

  async loadGrants() {
    const container = this.querySelector("[data-provider-grants-container]");
    if (!container) return;

    try {
      const response = await fetch("/api/provider/grants", {
        credentials: 'include'
      });
      if (!response.ok) throw new Error("Failed to load provider grants.");
      const data = await response.json();
      const grants = Array.isArray(data.grants) ? data.grants : [];

      container.innerHTML = "";
      if (grants.length === 0) {
        container.innerHTML = html`<div class="route-empty">No grants tracked.</div>`;
        return;
      }

      for (const grant of grants) {
        const card = document.createElement("div");
        card.className = "route-card";
        card.innerHTML = html`
          <div class="route-title">${grant.name}</div>
          <div>${grant.sponsor}</div>
          <div class="route-meta">Amount • ${grant.amount}</div>
          <div class="route-meta grant-status">Status • ${grant.status}</div>
          <div class="route-meta">Next report • ${grant.next_report || "TBD"}</div>
        `;
        container.appendChild(card);
      }
    } catch (error) {
      container.innerHTML = html`<div class="route-empty">Unable to load grants.</div>`;
    }
  }
}

customElements.define("app-route-provider-grants", AppRouteProviderGrants);
