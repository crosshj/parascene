class AppRouteCreate extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <style>
        .create-route {
          padding: 24px;
        }
        .create-route .route-header {
          margin-bottom: 24px;
        }
        .create-route .route-header h3 {
          margin: 0 0 8px 0;
          font-size: 1.5rem;
          font-weight: 600;
        }
        .create-route .route-header p {
          color: var(--text-muted);
          margin: 0 0 16px 0;
        }
        .create-route .create-controls {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-bottom: 24px;
        }
        .create-route .create-button {
          padding: 10px 20px;
          background: var(--accent);
          color: var(--accent-text);
          border: none;
          border-radius: 6px;
          font-size: 0.95rem;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s ease, transform 0.1s ease;
        }
        .create-route .create-button:hover:not(:disabled) {
          background: var(--focus);
          transform: translateY(-1px);
        }
        .create-route .create-button:active:not(:disabled) {
          transform: translateY(0);
        }
        .create-route .create-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .create-route .create-status {
          color: var(--text-muted);
          font-size: 0.9rem;
        }
        .create-route .create-status.loading {
          color: var(--accent);
        }
        .create-route .create-status.error {
          color: var(--error-text);
        }
      </style>
      <div class="create-route">
        <div class="route-header">
          <h3>Create</h3>
          <p>Make a new creation.  There will be a form here that is defined by the template and selected provider..</p>
        </div>
        <div class="create-controls">
          <button class="create-button" data-create-button>
            Create
          </button>
          <div class="create-status" data-create-status></div>
        </div>
      </div>
    `;
    this.setupEventListeners();
  }

  setupEventListeners() {
    const createButton = this.querySelector("[data-create-button]");
    if (createButton) {
      createButton.addEventListener("click", () => this.handleCreate());
    }
  }

  async handleCreate() {
    const button = this.querySelector("[data-create-button]");
    const status = this.querySelector("[data-create-status]");
    
    if (!button || !status) return;

    button.disabled = true;
    status.textContent = "Creating...";
    status.className = "create-status loading";

    try {
      const response = await fetch("/api/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create image");
      }

      const image = await response.json();
      status.textContent = "Image creation started!";
      status.className = "create-status";
      
      // Clear status after 2 seconds
      setTimeout(() => {
        status.textContent = "";
      }, 2000);
      
      // Navigate to Creations page
      const header = document.querySelector('app-header');
      if (header && typeof header.handleRouteChange === 'function') {
        window.history.pushState({ route: 'creations' }, '', '/creations');
        header.handleRouteChange();
      } else {
        // Fallback: use hash-based routing
        window.location.hash = 'creations';
      }
    } catch (error) {
      console.error("Error creating image:", error);
      status.textContent = error.message || "Failed to create image";
      status.className = "create-status error";
    } finally {
      button.disabled = false;
    }
  }
}

customElements.define("app-route-create", AppRouteCreate);
