class AppRouteProviderStatus extends HTMLElement {
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
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
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
      <div class="route-cards" data-provider-status-container>
        <div class="route-empty">Loading...</div>
      </div>
    `;
    this.loadStatuses();
  }

  async loadStatuses() {
    const container = this.querySelector("[data-provider-status-container]");
    if (!container) return;

    try {
      const response = await fetch("/api/provider/status");
      if (!response.ok) throw new Error("Failed to load provider status.");
      const data = await response.json();
      const statuses = Array.isArray(data.statuses) ? data.statuses : [];

      container.innerHTML = "";
      if (statuses.length === 0) {
        container.innerHTML = `<div class="route-empty">No provider status updates.</div>`;
        return;
      }

      for (const status of statuses) {
        const card = document.createElement("div");
        card.className = "route-card";
        card.innerHTML = `
          <div class="route-title">${status.provider_name}</div>
          <div class="route-meta">
            <span class="status-pill">${status.status}</span>
            <span>• ${status.region}</span>
          </div>
          <div class="route-stats">
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
      container.innerHTML = `<div class="route-empty">Unable to load status.</div>`;
    }
  }
}

customElements.define("app-route-provider-status", AppRouteProviderStatus);
