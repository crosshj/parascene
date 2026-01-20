const html = String.raw;

class AppRouteServers extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`
      <div class="route-header">
        <h3>Servers</h3>
        <p>You will find a list of servers here that you can join as well as those you have already joined.</p>
      </div>
      <div class="route-cards grid-auto-fit" data-servers-container>
        <div class="route-empty">Loading...</div>
      </div>
    `;
    this.loadServers();
  }

  async loadServers() {
    const container = this.querySelector("[data-servers-container]");
    if (!container) return;

    try {
      const response = await fetch("/api/servers", {
        credentials: 'include'
      });
      if (!response.ok) throw new Error("Failed to load servers.");
      const data = await response.json();
      const servers = Array.isArray(data.servers) ? data.servers : [];

      container.innerHTML = "";
      if (servers.length === 0) {
        container.innerHTML = html`<div class="route-empty">No servers available.</div>`;
        return;
      }

      for (const server of servers) {
        const card = document.createElement("div");
        card.className = "route-card";
        card.innerHTML = html`
          <div class="route-title">${server.name}</div>
          <div>${server.description}</div>
          <div class="route-meta">${server.region} • ${server.status}</div>
          <div class="route-meta">${server.members_count} members</div>
        `;
        container.appendChild(card);
      }
    } catch (error) {
      container.innerHTML = html`<div class="route-empty">Unable to load servers.</div>`;
    }
  }
}

customElements.define("app-route-servers", AppRouteServers);
