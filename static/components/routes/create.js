import { fetchJsonWithStatusDeduped } from '../../shared/api.js';
import { submitCreationWithPending } from '../../shared/createSubmit.js';
import { renderFields } from '../../shared/providerFormFields.js';

const html = String.raw;

class AppRouteCreate extends HTMLElement {
	constructor() {
		super();
		this.creditsCount = 0;
		this.selectedServer = null;
		this.selectedMethod = null;
		this.fieldValues = {};
		this.servers = [];
		this.handleCreditsUpdated = this.handleCreditsUpdated.bind(this);
		this.storageKey = 'create-page-selections';
	}

	connectedCallback() {
		this.innerHTML = html`
      <style>
        .create-route .create-form {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          margin-bottom: 1.5rem;
        }
        .create-route .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .create-route .form-label {
          font-size: 0.9rem;
          font-weight: 500;
          color: var(--text);
          display: inline-block;
        }
        .create-route .field-required {
          display: inline;
          margin-left: 2px;
        }
        .create-route .form-input,
        .create-route .form-select {
          padding: 0.75rem 1rem;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--input-bg);
          color: var(--text);
          font-size: 0.95rem;
          font-family: inherit;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .create-route .form-input:focus-visible,
        .create-route .form-select:focus-visible {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
        }
        .create-route .form-input::placeholder {
          color: var(--text-muted);
        }
        .create-route .form-input[type="color"] {
          height: 48px;
          cursor: pointer;
        }
        .create-route .create-controls {
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: flex-start;
          margin-top: 1.5rem;
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
        .create-route .field-required {
          color: var(--error, #e74c3c);
        }
      </style>
      <div class="create-route">
        <div class="route-header">
          <h3>Create</h3>
        </div>
        <app-tabs>
          <tab data-id="basic" label="Basic" default>
            <div class="route-header">
              <p>Select a server and generation method to create a new image.</p>
            </div>
            <form class="create-form" data-create-form>
              <div class="form-group">
                <label class="form-label" for="server-select">Server</label>
                <select class="form-select" id="server-select" data-server-select required>
                  <option value="">Select a server...</option>
                </select>
              </div>
              <div class="form-group" data-method-group style="display: none;">
                <label class="form-label" for="method-select">Generation Method</label>
                <select class="form-select" id="method-select" data-method-select required>
                  <option value="">Select a method...</option>
                </select>
              </div>
              <div class="form-group" data-fields-group style="display: none;">
                <div data-fields-container></div>
              </div>
            </form>
            <div class="create-controls">
              <button class="create-button" data-create-button disabled>
                Create
              </button>
              <p class="create-cost" data-create-cost>Select a server and method to see cost</p>
            </div>
          </tab>
          <tab data-id="advanced" label="Advanced">
            <div class="route-empty create-route-coming-soon">
              <p class="route-empty-message">
				Coming soon...
				Here you will be able to build, save, and share workflows.
				Workflows enable you to connect server methods together and source information from parascene api.
			  </p>
            </div>
          </tab>
        </app-tabs>
      </div>
    `;
		this.setupEventListeners();
		this.loadServers();
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

		const serverSelect = this.querySelector("[data-server-select]");
		if (serverSelect) {
			serverSelect.addEventListener("change", (e) => this.handleServerChange(e.target.value));
		}

		const methodSelect = this.querySelector("[data-method-select]");
		if (methodSelect) {
			methodSelect.addEventListener("change", (e) => this.handleMethodChange(e.target.value));
		}

		document.addEventListener('credits-updated', this.handleCreditsUpdated);
	}

	async loadServers() {
		try {
			const result = await fetchJsonWithStatusDeduped('/api/servers', { credentials: 'include' }, { windowMs: 2000 });
			if (result.ok) {
				this.servers = Array.isArray(result.data?.servers) ? result.data.servers : [];
				// Show servers where user is owner or member.
				// Additionally, the special server with id = 1 should always appear.
				this.servers = this.servers.filter(server =>
					server.id === 1 || server.is_owner === true || server.is_member === true
				);
				// Parse server_config if it's a string
				this.servers = this.servers.map(server => {
					if (server.server_config && typeof server.server_config === 'string') {
						try {
							server.server_config = JSON.parse(server.server_config);
						} catch (e) {
							// console.warn('Failed to parse server_config for server', server.id, e);
							server.server_config = null;
						}
					}
					return server;
				});
				this.renderServerOptions();

				// Try to restore selections, otherwise auto-select first server
				const restored = this.restoreSelections();
				if (!restored && this.servers.length > 0) {
					const firstServer = this.servers[0];
					const serverSelect = this.querySelector("[data-server-select]");
					if (serverSelect) {
						serverSelect.value = firstServer.id;
						this.handleServerChange(firstServer.id);
					}
				}
			}
		} catch (error) {
			// console.error('Error loading servers:', error);
		}
	}

	renderServerOptions() {
		const serverSelect = this.querySelector("[data-server-select]");
		if (!serverSelect) return;

		// Clear existing options except the first one
		while (serverSelect.children.length > 1) {
			serverSelect.removeChild(serverSelect.lastChild);
		}

		// Add server options
		this.servers.forEach(server => {
			const option = document.createElement('option');
			option.value = server.id;
			option.textContent = server.name;
			serverSelect.appendChild(option);
		});
	}

	handleServerChange(serverId) {
		if (!serverId) {
			this.selectedServer = null;
			this.selectedMethod = null;
			this.fieldValues = {};
			this.hideMethodGroup();
			this.hideFieldsGroup();
			this.updateButtonState();
			this.saveSelections();
			return;
		}

		const server = this.servers.find(s => s.id === Number(serverId));
		if (!server) return;

		this.selectedServer = server;
		this.selectedMethod = null;
		this.fieldValues = {};
		this.renderMethodOptions();
		this.hideFieldsGroup();
		this.updateButtonState();
		this.saveSelections();
	}

	renderMethodOptions(skipAutoSelect = false) {
		const methodGroup = this.querySelector("[data-method-group]");
		const methodSelect = this.querySelector("[data-method-select]");
		if (!methodGroup || !methodSelect) return;

		// Clear existing options except the first one
		while (methodSelect.children.length > 1) {
			methodSelect.removeChild(methodSelect.lastChild);
		}

		if (!this.selectedServer) {
			methodGroup.style.display = 'none';
			return;
		}

		// Ensure server_config is parsed
		let serverConfig = this.selectedServer.server_config;
		if (typeof serverConfig === 'string') {
			try {
				serverConfig = JSON.parse(serverConfig);
				this.selectedServer.server_config = serverConfig;
			} catch (e) {
				// console.warn('Failed to parse server_config:', e);
				methodGroup.style.display = 'none';
				return;
			}
		}

		if (!serverConfig || !serverConfig.methods) {
			methodGroup.style.display = 'none';
			return;
		}

		// Add method options
		const methods = serverConfig.methods;
		const methodKeys = Object.keys(methods);
		methodKeys.forEach(methodKey => {
			const method = methods[methodKey];
			const option = document.createElement('option');
			option.value = methodKey;
			option.textContent = method.name || methodKey;
			methodSelect.appendChild(option);
		});

		methodGroup.style.display = 'flex';

		// Auto-select first method if available (unless skipping auto-select)
		if (!skipAutoSelect && methodKeys.length > 0) {
			const firstMethodKey = methodKeys[0];
			methodSelect.value = firstMethodKey;
			// Use microtask to ensure DOM is ready and method selection happens after render
			Promise.resolve().then(() => {
				this.handleMethodChange(firstMethodKey);
			});
		} else if (methodKeys.length === 0) {
			methodSelect.value = '';
		}
	}

	handleMethodChange(methodKey) {
		if (!methodKey) {
			this.selectedMethod = null;
			this.fieldValues = {};
			this.hideFieldsGroup();
			this.updateButtonState();
			this.saveSelections();
			return;
		}

		if (!this.selectedServer) {
			return;
		}

		// Ensure server_config is parsed
		let serverConfig = this.selectedServer.server_config;
		if (typeof serverConfig === 'string') {
			try {
				serverConfig = JSON.parse(serverConfig);
				this.selectedServer.server_config = serverConfig;
			} catch (e) {
				// console.warn('Failed to parse server_config:', e);
				return;
			}
		}

		if (!serverConfig || !serverConfig.methods || !serverConfig.methods[methodKey]) {
			return;
		}

		this.selectedMethod = serverConfig.methods[methodKey];
		this.fieldValues = {};
		this.renderFields();
		this.updateButtonState();
		this.saveSelections();
	}

	renderFields() {
		const fieldsGroup = this.querySelector("[data-fields-group]");
		const fieldsContainer = this.querySelector("[data-fields-container]");
		if (!fieldsGroup || !fieldsContainer) return;

		if (!this.selectedMethod || !this.selectedMethod.fields) {
			fieldsGroup.style.display = 'none';
			return;
		}

		const fields = this.selectedMethod.fields;
		if (Object.keys(fields).length === 0) {
			fieldsGroup.style.display = 'none';
			return;
		}

		renderFields(fieldsContainer, fields, {
			onFieldChange: (fieldKey, value) => {
				this.fieldValues[fieldKey] = value;
				this.updateButtonState();
				this.saveSelections();
			}
		});
		fieldsGroup.style.display = 'flex';
	}

	hideMethodGroup() {
		const methodGroup = this.querySelector("[data-method-group]");
		const methodSelect = this.querySelector("[data-method-select]");
		if (methodGroup) methodGroup.style.display = 'none';
		if (methodSelect) methodSelect.value = '';
	}

	hideFieldsGroup() {
		const fieldsGroup = this.querySelector("[data-fields-group]");
		if (fieldsGroup) fieldsGroup.style.display = 'none';
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
			const result = await fetchJsonWithStatusDeduped('/api/credits', { credentials: 'include' }, { windowMs: 2000 });
			if (result.ok) {
				this.creditsCount = this.normalizeCredits(result.data?.balance ?? 0);
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

		// Check if server and method are selected
		if (!this.selectedServer || !this.selectedMethod) {
			button.disabled = true;
			costElement.textContent = 'Select a server and method to see cost';
			costElement.classList.remove('insufficient');
			return;
		}

		// Check if all required fields are filled
		const fields = this.selectedMethod.fields || {};
		const requiredFields = Object.keys(fields).filter(key => fields[key].required);
		const allRequiredFilled = requiredFields.every(key => {
			const value = this.fieldValues[key];
			return value !== undefined && value !== null && value !== '';
		});

		if (!allRequiredFilled) {
			button.disabled = true;
			// Get cost from method config
			let cost = 0.5; // default fallback
			if (this.selectedMethod && typeof this.selectedMethod.credits === 'number') {
				cost = this.selectedMethod.credits;
			} else if (this.selectedMethod && this.selectedMethod.credits !== undefined) {
				const parsedCost = parseFloat(this.selectedMethod.credits);
				if (!isNaN(parsedCost)) {
					cost = parsedCost;
				}
			}
			costElement.textContent = `Costs ${cost} credits - Fill all required fields`;
			costElement.classList.remove('insufficient');
			return;
		}

		// Check credits - get cost from method config
		let cost = 0.5; // default fallback
		if (this.selectedMethod) {
			if (typeof this.selectedMethod.credits === 'number') {
				cost = this.selectedMethod.credits;
			} else if (this.selectedMethod.credits !== undefined && this.selectedMethod.credits !== null) {
				// Try to parse if it's a string
				const parsedCost = parseFloat(this.selectedMethod.credits);
				if (!isNaN(parsedCost)) {
					cost = parsedCost;
				} else {
					// console.warn('updateButtonState - Could not parse credits:', this.selectedMethod.credits);
				}
			} else {
				// console.warn('updateButtonState - Credits is undefined or null, using default 0.5');
			}
		} else {
			// console.warn('updateButtonState - No selectedMethod');
		}

		const hasEnoughCredits = this.creditsCount >= cost;

		button.disabled = !hasEnoughCredits;

		if (hasEnoughCredits) {
			costElement.textContent = `Costs ${cost} credits`;
			costElement.classList.remove('insufficient');
		} else {
			costElement.textContent = `Insufficient credits. You have ${this.creditsCount} credits, need ${cost} credits.`;
			costElement.classList.add('insufficient');
		}
	}

	async handleCreate() {
		const button = this.querySelector("[data-create-button]");

		if (!button) return;

		if (!this.selectedServer || !this.selectedMethod) {
			return;
		}

		// Get the method key from the selected method
		const methods = this.selectedServer.server_config?.methods || {};
		const methodKey = Object.keys(methods).find(key => methods[key] === this.selectedMethod);

		if (!methodKey) {
			return;
		}

		// Collect all field values from inputs right before submission
		const fields = this.selectedMethod.fields || {};
		const collectedArgs = {};
		Object.keys(fields).forEach(fieldKey => {
			const input = this.querySelector(`#field-${fieldKey}`);
			if (input) {
				collectedArgs[fieldKey] = input.value || this.fieldValues[fieldKey] || '';
			} else {
				// Fallback to stored value
				collectedArgs[fieldKey] = this.fieldValues[fieldKey] || '';
			}
		});

		// Validate required data
		if (!this.selectedServer.id || !methodKey) {
			// console.error('Missing required data: server_id and method are required');
			return;
		}

		button.disabled = true;

		// Standalone create page (/create) needs full navigation to /creations; SPA only works when create is in-app.
		const isStandaloneCreatePage = window.location.pathname === '/create';
		submitCreationWithPending({
			serverId: this.selectedServer.id,
			methodKey,
			args: collectedArgs || {},
			navigate: isStandaloneCreatePage ? 'full' : 'spa',
			onInsufficientCredits: async () => {
				await this.loadCredits();
			},
			onError: async () => {
				await this.loadCredits();
			}
		});

		// In most cases we navigate away immediately; still re-enable just in case.
		setTimeout(() => {
			button.disabled = false;
		}, 0);
	}

	saveSelections() {
		try {
			const selections = {
				serverId: this.selectedServer?.id || null,
				methodKey: this.getMethodKey() || null,
				fieldValues: { ...this.fieldValues }
			};
			sessionStorage.setItem(this.storageKey, JSON.stringify(selections));
		} catch (e) {
			// Ignore storage errors
		}
	}

	getMethodKey() {
		if (!this.selectedServer || !this.selectedMethod) return null;
		const methods = this.selectedServer.server_config?.methods || {};
		return Object.keys(methods).find(key => methods[key] === this.selectedMethod) || null;
	}

	restoreSelections() {
		// Only restore if servers are loaded
		if (!this.servers || this.servers.length === 0) return false;

		try {
			const stored = sessionStorage.getItem(this.storageKey);
			if (!stored) return false;

			const selections = JSON.parse(stored);
			if (!selections || !selections.serverId) return false;

			// Restore server selection
			const server = this.servers.find(s => s.id === Number(selections.serverId));
			if (!server) return false;

			const serverSelect = this.querySelector("[data-server-select]");
			if (!serverSelect) return false;

			serverSelect.value = server.id;
			this.selectedServer = server;
			this.renderMethodOptions(true); // Skip auto-select when restoring

			// Restore method selection after methods are rendered
			if (selections.methodKey) {
				// Use microtask to ensure DOM is ready
				Promise.resolve().then(() => {
					const methodSelect = this.querySelector("[data-method-select]");
					if (methodSelect) {
						const methodExists = Array.from(methodSelect.options).some(
							opt => opt.value === selections.methodKey
						);
						if (methodExists) {
							methodSelect.value = selections.methodKey;
							this.handleMethodChange(selections.methodKey);

							// Restore field values after fields are rendered
							if (selections.fieldValues && Object.keys(selections.fieldValues).length > 0) {
								Promise.resolve().then(() => {
									this.restoreFieldValues(selections.fieldValues);
								});
							}
						}
					}
				});
			}

			return true;
		} catch (e) {
			// Ignore storage errors
			return false;
		}
	}

	restoreFieldValues(savedFieldValues) {
		Object.keys(savedFieldValues).forEach(fieldKey => {
			const input = this.querySelector(`#field-${fieldKey}`);
			if (input) {
				const savedValue = savedFieldValues[fieldKey];
				if (savedValue !== undefined && savedValue !== null && savedValue !== '') {
					if (input.type === 'checkbox') {
						input.checked = savedValue === true || savedValue === 'true';
					} else {
						input.value = savedValue;
					}
					// Trigger change event to update fieldValues and button state
					input.dispatchEvent(new Event('input', { bubbles: true }));
					input.dispatchEvent(new Event('change', { bubbles: true }));
				}
			}
		});
	}
}

customElements.define("app-route-create", AppRouteCreate);
