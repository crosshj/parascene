const html = String.raw;

class AppModalCreationDetails extends HTMLElement {
	constructor() {
		super();
		this._isOpen = false;
		this._meta = null;
		this._creationId = null;
		this.handleEscape = this.handleEscape.bind(this);
		this.handleOpen = this.handleOpen.bind(this);
	}

	connectedCallback() {
		this.render();
		this.setupEventListeners();
	}

	disconnectedCallback() {
		document.removeEventListener("keydown", this.handleEscape);
		document.removeEventListener("open-creation-details-modal", this.handleOpen);
	}

	render() {
		this.innerHTML = html`
			<div class="modal-overlay" data-overlay>
				<div class="modal modal-medium">
					<div class="modal-header">
						<h3>More Info</h3>
						<button class="modal-close" type="button" aria-label="Close">
							<svg class="modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
								stroke-linecap="round" stroke-linejoin="round">
								<line x1="18" y1="6" x2="6" y2="18"></line>
								<line x1="6" y1="6" x2="18" y2="18"></line>
							</svg>
						</button>
					</div>
					<div class="modal-body">
						<div class="field">
							<div class="label">Server</div>
							<div class="value" data-server></div>
						</div>
						<div class="field">
							<div class="label">Method</div>
							<div class="value" data-method></div>
						</div>
						<div class="field">
							<div class="label">Duration</div>
							<div class="value" data-duration></div>
						</div>
						<div class="field" data-prompt-field style="display: none;">
							<div class="label">Prompt</div>
							<div class="value" data-prompt></div>
						</div>
						<div class="field" data-args-field>
							<div class="label">Arguments</div>
							<pre class="creation-details-args" data-args></pre>
						</div>
						<div class="field" data-history-field style="display: none;">
							<div class="label">History</div>
							<div class="value" data-history></div>
						</div>
						<div class="field" data-provider-error-field style="display: none;">
							<div class="label">Provider error</div>
							<pre class="creation-details-args" data-provider-error></pre>
						</div>
					</div>
					<div class="modal-footer">
						<button type="button" class="btn-secondary" data-close-secondary>Close</button>
					</div>
				</div>
			</div>
		`;

		// Styles for history links (shared with modal styling)
		const style = document.createElement('style');
		style.textContent = `
			.creation-details-history-link {
				color: var(--accent);
				text-decoration: none;
				font-weight: 600;
			}

			.creation-details-history-link:hover {
				text-decoration: underline;
			}
		`;
		this.appendChild(style);
	}

	setupEventListeners() {
		document.addEventListener("keydown", this.handleEscape);
		document.addEventListener("open-creation-details-modal", this.handleOpen);

		const overlay = this.querySelector("[data-overlay]");
		const closeBtn = this.querySelector(".modal-close");
		const closeSecondary = this.querySelector("[data-close-secondary]");

		if (overlay) {
			overlay.addEventListener("click", (e) => {
				if (e.target === overlay) {
					this.close();
				}
			});
		}

		if (closeBtn) {
			closeBtn.addEventListener("click", () => this.close());
		}

		if (closeSecondary) {
			closeSecondary.addEventListener("click", () => this.close());
		}
	}

	handleEscape(event) {
		if (event.key === "Escape" && this._isOpen) {
			this.close();
		}
	}

	handleOpen(event) {
		const detail = event.detail || {};
		this._meta = detail.meta || null;
		this._creationId = detail.creationId || null;
		this.updateContent();
		this.open();
	}

	formatDuration(meta) {
		if (!meta) return "Unknown";
		const durationMs =
			typeof meta.duration_ms === "number" && Number.isFinite(meta.duration_ms)
				? meta.duration_ms
				: null;

		let ms = durationMs;
		if (ms == null) {
			const started = meta.started_at ? Date.parse(meta.started_at) : NaN;
			const endedRaw = meta.completed_at || meta.failed_at || null;
			const ended = endedRaw ? Date.parse(endedRaw) : NaN;
			if (Number.isFinite(started) && Number.isFinite(ended) && ended >= started) {
				ms = ended - started;
			}
		}

		if (!Number.isFinite(ms) || ms <= 0) return "Unknown";

		const seconds = ms / 1000;
		if (seconds < 60) {
			return `${seconds.toFixed(1)}s`;
		}
		const minutes = Math.floor(seconds / 60);
		const rem = Math.round(seconds % 60);
		if (minutes >= 60) {
			const hours = Math.floor(minutes / 60);
			const remMin = minutes % 60;
			return `${hours}h ${remMin}m`;
		}
		return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`;
	}

	updateContent() {
		const meta = this._meta || {};
		const serverEl = this.querySelector("[data-server]");
		const methodEl = this.querySelector("[data-method]");
		const durationEl = this.querySelector("[data-duration]");
		const argsEl = this.querySelector("[data-args]");
		const promptField = this.querySelector("[data-prompt-field]");
		const promptEl = this.querySelector("[data-prompt]");
		const argsField = this.querySelector("[data-args-field]");
		const historyField = this.querySelector("[data-history-field]");
		const historyEl = this.querySelector("[data-history]");
		const providerErrorField = this.querySelector("[data-provider-error-field]");
		const providerErrorEl = this.querySelector("[data-provider-error]");

		const serverId = meta.server_id != null ? String(meta.server_id) : "Unknown";
		const serverUrl = typeof meta.server_url === "string" ? meta.server_url : "";
		const serverName = typeof meta.server_name === "string" && meta.server_name.trim()
			? meta.server_name.trim()
			: null;
		const method = typeof meta.method === "string" ? meta.method : "Unknown";
		const methodName = typeof meta.method_name === "string" && meta.method_name.trim()
			? meta.method_name.trim()
			: null;

		if (serverEl) {
			if (serverName) {
				serverEl.textContent = serverName;
			} else if (serverUrl) {
				serverEl.textContent = `${serverId} — ${serverUrl}`;
			} else {
				serverEl.textContent = serverId;
			}
		}

		if (methodEl) {
			methodEl.textContent = methodName || method;
		}

		if (durationEl) {
			durationEl.textContent = this.formatDuration(meta);
		}

		const args = meta.args ?? null;
		const isPlainObject = args && typeof args === "object" && !Array.isArray(args);
		const argKeys = isPlainObject ? Object.keys(args) : [];
		const isPromptOnly = isPlainObject && argKeys.length === 1 && Object.prototype.hasOwnProperty.call(args, "prompt");

		if (isPromptOnly) {
			if (promptField && promptEl) {
				promptField.style.display = "";
				promptEl.textContent = String(args.prompt ?? "");
			}
			if (argsField) {
				argsField.style.display = "none";
			}
		} else {
			if (promptField) {
				promptField.style.display = "none";
			}
			if (argsField) {
				argsField.style.display = "";
			}
			if (argsEl) {
				try {
					const pretty = JSON.stringify(args ?? {}, null, 2);
					argsEl.textContent = pretty;
				} catch {
					argsEl.textContent = String(args ?? "");
				}
			}
		}

		// History (mutations lineage)
		const historyRaw = meta.history;
		const historyIds = Array.isArray(historyRaw)
			? historyRaw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
			: [];
		if (historyField instanceof HTMLElement && historyEl) {
			if (historyIds.length === 0) {
				historyField.style.display = "none";
				historyEl.textContent = "";
			} else {
				historyField.style.display = "";
				// Render as links to creation pages (most recent last)
				historyEl.innerHTML = historyIds
					.map((id) => `<a class="creation-details-history-link" href="/creations/${id}">#${id}</a>`)
					.join(" → ");
			}
		}

		// Provider error details (non-2xx payloads captured from provider)
		const providerError = meta.provider_error ?? null;
		if (providerErrorField instanceof HTMLElement && providerErrorEl) {
			if (!providerError || typeof providerError !== "object") {
				providerErrorField.style.display = "none";
				providerErrorEl.textContent = "";
			} else {
				providerErrorField.style.display = "";
				try {
					// Prefer showing provider's own error/message if present.
					const body = providerError.body;
					const msg =
						body && typeof body === "object"
							? (typeof body.error === "string" ? body.error : (typeof body.message === "string" ? body.message : ""))
							: (typeof body === "string" ? body : "");
					if (msg) {
						providerErrorEl.textContent = msg;
					} else {
						providerErrorEl.textContent = JSON.stringify(providerError, null, 2);
					}
				} catch {
					providerErrorEl.textContent = String(providerError);
				}
			}
		}
	}

	open() {
		if (this._isOpen) return;
		this._isOpen = true;
		const overlay = this.querySelector("[data-overlay]");
		if (overlay) {
			overlay.classList.add("open");
		}
	}

	close() {
		if (!this._isOpen) return;
		this._isOpen = false;
		const overlay = this.querySelector("[data-overlay]");
		if (overlay) {
			overlay.classList.remove("open");
		}
	}
}

customElements.define("app-modal-creation-details", AppModalCreationDetails);

