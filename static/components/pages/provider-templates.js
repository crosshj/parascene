const html = String.raw;

class AppRouteProviderTemplates extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`
      <div class="route-header">
        <h3>Templates</h3>
        <p>Hosted templates currently available for provider deployments.</p>
      </div>
      <div class="route-cards grid-auto-fit" data-provider-templates-container>
        <div class="route-empty">Loading...</div>
      </div>
    `;
    this.loadTemplates();
  }

  async loadTemplates() {
    const container = this.querySelector("[data-provider-templates-container]");
    if (!container) return;

    try {
      const response = await fetch("/api/provider/templates-hosted", {
        credentials: 'include'
      });
      if (!response.ok) throw new Error("Failed to load provider templates.");
      const data = await response.json();
      const templates = Array.isArray(data.templates) ? data.templates : [];

      container.innerHTML = "";
      if (templates.length === 0) {
        container.innerHTML = html`<div class="route-empty">No hosted templates.</div>`;
        return;
      }

      for (const template of templates) {
        const card = document.createElement("div");
        card.className = "route-card";
        card.innerHTML = html`
          <div class="route-title">${template.name}</div>
          <div>${template.category}</div>
          <div class="route-meta">Version • ${template.version}</div>
          <div class="route-meta">Deployments • ${template.deployments}</div>
          <div class="route-meta">Updated • ${template.updated_at}</div>
        `;
        container.appendChild(card);
      }
    } catch (error) {
      container.innerHTML = html`<div class="route-empty">Unable to load templates.</div>`;
    }
  }
}

customElements.define("app-route-provider-templates", AppRouteProviderTemplates);
