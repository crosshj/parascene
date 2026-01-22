const html = String.raw;

class AppRouteCreate extends HTMLElement {
  constructor() {
    super();
    this.creditsCount = 0;
    this.CREATION_CREDIT_COST = 0.5;
    this.handleCreditsUpdated = this.handleCreditsUpdated.bind(this);
  }

  connectedCallback() {
    this.innerHTML = html`
      <style>
        .create-route .create-controls {
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: flex-start;
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
        .create-route .create-cost {
          font-size: 0.875rem;
          color: var(--text-muted);
          margin: 0;
        }
        .create-route .create-cost.insufficient {
          color: var(--error, #e74c3c);
          font-weight: 500;
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
          <p class="create-cost" data-create-cost>Costs 0.5 credits</p>
        </div>
      </div>
    `;
    this.setupEventListeners();
    this.loadCredits();
  }

  disconnectedCallback() {
    document.removeEventListener('credits-updated', this.handleCreditsUpdated);
  }

  setupEventListeners() {
    const createButton = this.querySelector("[data-create-button]");
    if (createButton) {
      createButton.addEventListener("click", () => this.handleCreate());
    }
    document.addEventListener('credits-updated', this.handleCreditsUpdated);
  }

  handleCreditsUpdated(event) {
    if (event.detail && typeof event.detail.count === 'number') {
      this.creditsCount = event.detail.count;
      this.updateButtonState();
    } else {
      this.loadCredits();
    }
  }

  async loadCredits() {
    try {
      const response = await fetch('/api/credits', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        this.creditsCount = this.normalizeCredits(data?.balance ?? 0);
        this.updateButtonState();
      } else {
        this.creditsCount = 0;
        this.updateButtonState();
      }
    } catch {
      // Fallback to localStorage if available
      const stored = window.localStorage?.getItem('credits-balance');
      this.creditsCount = stored !== null ? this.normalizeCredits(stored) : 0;
      this.updateButtonState();
    }
  }

  normalizeCredits(value) {
    const count = Number(value);
    if (!Number.isFinite(count)) return 0;
    return Math.max(0, Math.round(count * 10) / 10);
  }

  updateButtonState() {
    const button = this.querySelector("[data-create-button]");
    const costElement = this.querySelector("[data-create-cost]");
    
    if (!button || !costElement) return;

    const hasEnoughCredits = this.creditsCount >= this.CREATION_CREDIT_COST;
    
    button.disabled = !hasEnoughCredits;
    
    if (hasEnoughCredits) {
      costElement.textContent = `Costs ${this.CREATION_CREDIT_COST} credits`;
      costElement.classList.remove('insufficient');
    } else {
      costElement.textContent = `Insufficient credits. You have ${this.creditsCount} credits, need ${this.CREATION_CREDIT_COST} credits.`;
      costElement.classList.add('insufficient');
    }
  }

  async handleCreate() {
    const button = this.querySelector("[data-create-button]");
    
    if (!button) return;

    // Double-check credits before allowing creation
    if (this.creditsCount < this.CREATION_CREDIT_COST) {
      return;
    }

    if (typeof this.onCreate === "function") {
      this.onCreate({ button });
    }
  }
}

customElements.define("app-route-create", AppRouteCreate);
