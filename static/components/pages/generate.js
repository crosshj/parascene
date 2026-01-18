class AppRouteGenerate extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <style>
        .generate-route {
          padding: 24px;
        }
        .generate-route .route-header {
          margin-bottom: 24px;
        }
        .generate-route .route-header h3 {
          margin: 0 0 8px 0;
          font-size: 1.5rem;
          font-weight: 600;
        }
        .generate-route .route-header p {
          color: var(--text-muted);
          margin: 0 0 16px 0;
        }
        .generate-route .generate-controls {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-bottom: 24px;
        }
        .generate-route .generate-button {
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
        .generate-route .generate-button:hover:not(:disabled) {
          background: var(--focus);
          transform: translateY(-1px);
        }
        .generate-route .generate-button:active:not(:disabled) {
          transform: translateY(0);
        }
        .generate-route .generate-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .generate-route .generate-status {
          color: var(--text-muted);
          font-size: 0.9rem;
        }
        .generate-route .generate-status.loading {
          color: var(--accent);
        }
        .generate-route .generate-status.error {
          color: var(--error-text);
        }
        .generate-route .generating-list {
          margin-top: 24px;
        }
        .generate-route .generating-list-title {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--text-muted);
          margin-bottom: 12px;
        }
        .generate-route .generating-item {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .generate-route .generating-item-status {
          font-size: 0.85rem;
          color: var(--accent);
        }
        .generate-route .generating-item-time {
          font-size: 0.8rem;
          color: var(--text-muted);
          margin-left: auto;
        }
      </style>
      <div class="generate-route">
        <div class="route-header">
          <h3>Generate</h3>
          <p>Create new images with random colors. Each image is 1024x1024 pixels.</p>
        </div>
        <div class="generate-controls">
          <button class="generate-button" data-generate-button>
            Generate Image
          </button>
          <div class="generate-status" data-generate-status></div>
        </div>
        <div class="generating-list" data-generating-list style="display: none;">
          <div class="generating-list-title">Generating Images</div>
          <div data-generating-items></div>
        </div>
      </div>
    `;
    this.pollInterval = null;
    this.setupEventListeners();
    this.startPolling();
  }

  disconnectedCallback() {
    this.stopPolling();
  }

  startPolling() {
    // Poll every 2 seconds for images that are still generating
    this.pollInterval = setInterval(() => {
      this.checkGeneratingImages();
    }, 2000);
    
    // Also check immediately
    this.checkGeneratingImages();
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async checkGeneratingImages() {
    const listContainer = this.querySelector("[data-generating-list]");
    const itemsContainer = this.querySelector("[data-generating-items]");
    
    if (!listContainer || !itemsContainer) return;

    try {
      const response = await fetch("/api/generate/images");
      if (!response.ok) return;

      const data = await response.json();
      const images = Array.isArray(data.images) ? data.images : [];
      
      // Filter for images that are still generating
      const generatingImages = images.filter(
        img => img.status === 'generating' || img.status === 'pending'
      );

      if (generatingImages.length === 0) {
        listContainer.style.display = 'none';
        itemsContainer.innerHTML = '';
        return;
      }

      // Show the list
      listContainer.style.display = 'block';
      
      // Update the list
      itemsContainer.innerHTML = '';
      for (const image of generatingImages) {
        const item = document.createElement("div");
        item.className = "generating-item";
        const timeAgo = this.getTimeAgo(new Date(image.created_at));
        item.innerHTML = `
          <div class="generating-item-status">🔄 Generating...</div>
          <div class="generating-item-time">Started ${timeAgo}</div>
        `;
        itemsContainer.appendChild(item);
      }
    } catch (error) {
      console.error("Error checking generating images:", error);
    }
  }

  getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  }

  setupEventListeners() {
    const generateButton = this.querySelector("[data-generate-button]");
    if (generateButton) {
      generateButton.addEventListener("click", () => this.handleGenerate());
    }
  }

  async handleGenerate() {
    const button = this.querySelector("[data-generate-button]");
    const status = this.querySelector("[data-generate-status]");
    
    if (!button || !status) return;

    button.disabled = true;
    status.textContent = "Generating...";
    status.className = "generate-status loading";

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to generate image");
      }

      const image = await response.json();
      status.textContent = "Image generation started!";
      status.className = "generate-status";
      
      // Clear status after 2 seconds
      setTimeout(() => {
        status.textContent = "";
      }, 2000);

      // Check for generating images immediately
      this.checkGeneratingImages();
      
      // Navigate to Creations page
      const header = document.querySelector('app-header');
      if (header && typeof header.handleRouteChange === 'function') {
        window.history.pushState({ route: 'posts' }, '', '/posts');
        header.handleRouteChange();
      } else {
        // Fallback: use hash-based routing
        window.location.hash = 'posts';
      }
    } catch (error) {
      console.error("Error generating image:", error);
      status.textContent = error.message || "Failed to generate image";
      status.className = "generate-status error";
    } finally {
      button.disabled = false;
    }
  }
}

customElements.define("app-route-generate", AppRouteGenerate);
