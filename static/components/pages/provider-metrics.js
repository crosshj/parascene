import { fetchJsonWithStatusDeduped } from '../../shared/api.js';

const html = String.raw;

class AppRouteProviderMetrics extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`
      <style>
        .metric-card {
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
      </style>
      <div class="route-header">
        <h3>Metrics</h3>
        <p>Operational performance highlights from the last reporting windows.</p>
      </div>
      <div class="grid-auto-fit-sm" data-provider-metrics-container>
        <div class="route-empty route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>
      </div>
    `;
    this.loadMetrics();
  }

  async loadMetrics() {
    const container = this.querySelector("[data-provider-metrics-container]");
    if (!container) return;

    try {
      const result = await fetchJsonWithStatusDeduped("/api/provider/metrics", {
        credentials: 'include'
      }, { windowMs: 2000 });
      if (!result.ok) throw new Error("Failed to load provider metrics.");
      const metrics = Array.isArray(result.data?.metrics) ? result.data.metrics : [];

      container.innerHTML = "";
      if (metrics.length === 0) {
        container.innerHTML = html`<div class="route-empty">No metrics available.</div>`;
        return;
      }

      for (const metric of metrics) {
        const card = document.createElement("div");
        card.className = "card route-card metric-card";
        const unit = metric.unit ? ` ${metric.unit}` : "";
        card.innerHTML = html`
          <div class="metric-title">${metric.name}</div>
          <div class="metric-value">${metric.value}${unit}</div>
          <div class="metric-meta">${metric.change || ""}</div>
          <div class="metric-meta">${metric.period || ""}</div>
          <div class="metric-meta">${metric.description || ""}</div>
        `;
        container.appendChild(card);
      }
    } catch (error) {
      container.innerHTML = html`<div class="route-empty">Unable to load metrics.</div>`;
    }
  }
}

customElements.define("app-route-provider-metrics", AppRouteProviderMetrics);
