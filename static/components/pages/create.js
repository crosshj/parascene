const html = String.raw;

class AppRouteCreate extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`
      <style>
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
    
    if (!button) return;

    if (typeof this.onCreate === "function") {
      this.onCreate({ button });
    }
  }
}

customElements.define("app-route-create", AppRouteCreate);
