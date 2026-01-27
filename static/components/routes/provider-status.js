import { fetchJsonWithStatusDeduped } from '../../shared/api.js';

const html = String.raw;

class AppRouteProviderStatus extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`
      <style>
        .status-pill {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: capitalize;
          background: var(--surface-strong);
          color: var(--text);
        }
        .route-stats {
          font-size: 0.85rem;
        }
        .stat-label {
          color: var(--text-muted);
          display: block;
          font-size: 0.75rem;
        }
      </style>
      <div class="route-header">
        <h3>Status</h3>
        <p>Live provider health checks and regional capacity snapshots.</p>
      </div>
      <div class="route-cards grid-auto-fit" data-provider-status-container>
        <div class="route-empty route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>
      </div>
    `;
    this.loadStatuses();
  }

  async loadStatuses() {
    const container = this.querySelector("[data-provider-status-container]");
    if (!container) return;

    try {
      const result = await fetchJsonWithStatusDeduped("/api/provider/status", {
        credentials: 'include'
      }, { windowMs: 2000 });
      if (!result.ok) throw new Error("Failed to load provider status.");
      const statuses = Array.isArray(result.data?.statuses) ? result.data.statuses : [];

      container.innerHTML = "";
      if (statuses.length === 0) {
        container.innerHTML = html`<div class="route-empty">No provider status updates.</div>`;
        return;
      }

      for (const status of statuses) {
        const card = document.createElement("div");
        card.className = "route-card";
        card.innerHTML = html`
          <div class="route-title">${status.provider_name}</div>
          <div class="route-meta">
            <span class="status-pill">${status.status}</span>
            <span>• ${status.region}</span>
          </div>
          <div class="grid-2-col route-stats">
            <div>
              <span class="stat-label">Uptime</span>
              ${Number(status.uptime_pct).toFixed(2)}%
            </div>
            <div>
              <span class="stat-label">Capacity</span>
              ${Number(status.capacity_pct).toFixed(0)}%
            </div>
          </div>
          <div class="route-meta">Last check ${status.last_check_at || "—"}</div>
        `;
        container.appendChild(card);
      }
    } catch (error) {
      container.innerHTML = html`<div class="route-empty">Unable to load status.</div>`;
    }
  }
}

customElements.define("app-route-provider-status", AppRouteProviderStatus);
