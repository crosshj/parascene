const html = String.raw;

class AppModalCreationDetails extends HTMLElement {
	constructor() {
		super();
		this._isOpen = false;
		this._meta = null;
		this._creationId = null;
		this._description = '';
		this._groupContext = null;
		this.handleEscape = this.handleEscape.bind(this);
		this.handleOpen = this.handleOpen.bind(this);
		this.handleCloseAllModals = this.handleCloseAllModals.bind(this);
	}

	connectedCallback() {
		this.setAttribute('data-modal', '');
		this.render();
		this.setupEventListeners();
	}

	disconnectedCallback() {
		document.removeEventListener("keydown", this.handleEscape);
		document.removeEventListener("open-creation-details-modal", this.handleOpen);
		document.removeEventListener("close-all-modals", this.handleCloseAllModals);
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
						<div class="field" data-group-context-field style="display: none;">
							<div class="label">Grouped creation</div>
							<p class="creation-details-args-hint" data-group-context-hint></p>
							<pre class="creation-details-args" data-group-context></pre>
						</div>
						<div class="field" data-args-field>
							<div class="label">Sent to provider</div>
							<p class="creation-details-args-hint" data-args-hint>Exact <code>method</code> and <code>args</code> payload used for the generation job.</p>
							<pre class="creation-details-args" data-args></pre>
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

	}

	setupEventListeners() {
		document.addEventListener("keydown", this.handleEscape);
		document.addEventListener("open-creation-details-modal", this.handleOpen);
		document.addEventListener("close-all-modals", this.handleCloseAllModals);

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

	handleCloseAllModals() {
		this.close();
	}

	handleOpen(event) {
		const detail = event.detail || {};
		this._meta = detail.meta || null;
		this._creationId = detail.creationId || null;
		this._description = detail.description || '';
		this._groupContext = detail.groupContext && typeof detail.groupContext === 'object' ? detail.groupContext : null;
		this.updateContent();
		this.open();
	}

	updateContent() {
		const meta = this._meta || {};
		const groupContext = this._groupContext;
		const groupField = this.querySelector("[data-group-context-field]");
		const groupHint = this.querySelector("[data-group-context-hint]");
		const groupEl = this.querySelector("[data-group-context]");
		const argsEl = this.querySelector("[data-args]");
		const argsField = this.querySelector("[data-args-field]");
		const argsHint = this.querySelector("[data-args-hint]");
		const providerErrorField = this.querySelector("[data-provider-error-field]");
		const providerErrorEl = this.querySelector("[data-provider-error]");

		if (groupField instanceof HTMLElement && groupEl) {
			if (!groupContext) {
				groupField.style.display = "none";
				groupEl.textContent = "";
				if (groupHint) groupHint.textContent = "";
			} else {
				groupField.style.display = "";
				const selectedTitle =
					typeof groupContext.selectedSourceTitle === "string" && groupContext.selectedSourceTitle.trim()
						? groupContext.selectedSourceTitle.trim()
						: (groupContext.selectedSourceId != null ? `#${groupContext.selectedSourceId}` : "—");
				if (groupHint) {
					groupHint.textContent =
						`Group row #${groupContext.groupCreationId ?? "—"} · ${groupContext.sourceCount ?? 0} sources · showing generation info for the selected image (${selectedTitle}).`;
				}
				try {
					groupEl.textContent = JSON.stringify(groupContext, null, 2);
				} catch {
					groupEl.textContent = String(groupContext);
				}
			}
		}

		const args = meta.args ?? null;
		const isPlainObject = args && typeof args === "object" && !Array.isArray(args);

		if (argsField) {
			argsField.style.display = isPlainObject ? "" : "none";
		}
		if (argsHint) {
			argsHint.style.display = isPlainObject
				? (groupContext ? "none" : "")
				: "none";
		}
		if (argsHint && isPlainObject && groupContext) {
			argsHint.textContent = "Provider payload for the selected group source (not the group row).";
			argsHint.style.display = "";
		} else if (argsHint && isPlainObject) {
			argsHint.textContent = "Exact method and args payload used for the generation job.";
		}
		if (argsEl && isPlainObject) {
			try {
				const payload = {
					method: typeof meta.method === "string" ? meta.method : null,
					server_id: meta.server_id != null ? meta.server_id : null,
					args
				};
				argsEl.textContent = JSON.stringify(payload, null, 2);
			} catch {
				argsEl.textContent = String(args ?? "");
			}
		} else if (argsEl) {
			argsEl.textContent = "";
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

