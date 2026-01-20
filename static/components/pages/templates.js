const html = String.raw;

class AppRouteTemplates extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`
      <div class="route-header">
        <h3>Templates</h3>
        <p>Templates ready to bootstrap new workspaces.</p>
      </div>
      <div class="route-cards cards-grid-auto" data-templates-container>
        <div class="route-empty">Loading...</div>
      </div>
    `;
    this.loadTemplates();
  }

  async loadTemplates() {
    const container = this.querySelector("[data-templates-container]");
    if (!container) return;

    try {
      const response = await fetch("/api/templates", {
        credentials: 'include'
      });
      if (!response.ok) throw new Error("Failed to load templates.");
      const data = await response.json();
      const templates = Array.isArray(data.templates) ? data.templates : [];

      container.innerHTML = "";
      if (templates.length === 0) {
        container.innerHTML = html`<div class="route-empty">No templates yet.</div>`;
        return;
      }

      for (const template of templates) {
        const card = document.createElement("div");
        card.className = "route-card";
        card.innerHTML = html`
          <div class="route-title">${template.name}</div>
          <div>${template.description}</div>
          <div class="route-meta">${template.category}</div>
        `;
        container.appendChild(card);
      }
    } catch (error) {
      container.innerHTML = html`<div class="route-empty">Unable to load templates.</div>`;
    }
  }
}

customElements.define("app-route-templates", AppRouteTemplates);
