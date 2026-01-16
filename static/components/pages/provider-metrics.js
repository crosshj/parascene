class AppRouteProviderMetrics extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <style>
        .route-header {
          margin-bottom: 12px;
        }
        .route-header p {
          color: var(--text-muted);
        }
        .metric-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 12px;
        }
        .metric-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 14px;
          box-shadow: var(--shadow);
          display: grid;
          gap: 8px;
        }
        .metric-title {
          font-weight: 600;
        }
        .metric-value {
          font-size: 1.4rem;
          font-weight: 700;
        }
        .metric-meta {
          font-size: 0.85rem;
          color: var(--text-muted);
        }
        .route-empty {
          color: var(--text-muted);
        }
      </style>
      <div class="route-header">
        <h3>Metrics</h3>
        <p>Operational performance highlights from the last reporting windows.</p>
      </div>
      <div class="metric-grid" data-provider-metrics-container>
        <div class="route-empty">Loading...</div>
      </div>
    `;
    this.loadMetrics();
  }

  async loadMetrics() {
    const container = this.querySelector("[data-provider-metrics-container]");
    if (!container) return;

    try {
      const response = await fetch("/api/provider/metrics");
      if (!response.ok) throw new Error("Failed to load provider metrics.");
      const data = await response.json();
      const metrics = Array.isArray(data.metrics) ? data.metrics : [];

      container.innerHTML = "";
      if (metrics.length === 0) {
        container.innerHTML = `<div class="route-empty">No metrics available.</div>`;
        return;
      }

      for (const metric of metrics) {
        const card = document.createElement("div");
        card.className = "metric-card";
        const unit = metric.unit ? ` ${metric.unit}` : "";
        card.innerHTML = `
          <div class="metric-title">${metric.name}</div>
          <div class="metric-value">${metric.value}${unit}</div>
          <div class="metric-meta">${metric.change || ""}</div>
          <div class="metric-meta">${metric.period || ""}</div>
          <div class="metric-meta">${metric.description || ""}</div>
        `;
        container.appendChild(card);
      }
    } catch (error) {
      container.innerHTML = `<div class="route-empty">Unable to load metrics.</div>`;
    }
  }
}

customElements.define("app-route-provider-metrics", AppRouteProviderMetrics);
