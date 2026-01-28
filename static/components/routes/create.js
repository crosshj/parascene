import { fetchJsonWithStatusDeduped } from '../../shared/api.js';

const html = String.raw;

function generateCreationToken() {
	const ts = Date.now().toString(36);
	const rand = Math.random().toString(36).slice(2, 10);
	return `crt_${ts}_${rand}`;
}

class AppRouteCreate extends HTMLElement {
	constructor() {
		super();
		this.creditsCount = 0;
		this.selectedServer = null;
		this.selectedMethod = null;
		this.fieldValues = {};
		this.servers = [];
		this.handleCreditsUpdated = this.handleCreditsUpdated.bind(this);
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
							console.warn('Failed to parse server_config for server', server.id, e);
							server.server_config = null;
						}
					}
					return server;
				});
				this.renderServerOptions();

				// Auto-select first server if available
				if (this.servers.length > 0) {
					const firstServer = this.servers[0];
					const serverSelect = this.querySelector("[data-server-select]");
					if (serverSelect) {
						serverSelect.value = firstServer.id;
						this.handleServerChange(firstServer.id);
					}
				}
			}
		} catch (error) {
			console.error('Error loading servers:', error);
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
	}

	renderMethodOptions() {
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
				console.warn('Failed to parse server_config:', e);
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

		// Auto-select first method if available
		if (methodKeys.length > 0) {
			const firstMethodKey = methodKeys[0];
			methodSelect.value = firstMethodKey;
			// Use microtask to ensure DOM is ready and method selection happens after render
			Promise.resolve().then(() => {
				this.handleMethodChange(firstMethodKey);
			});
		} else {
			methodSelect.value = '';
		}
	}

	handleMethodChange(methodKey) {
		if (!methodKey) {
			this.selectedMethod = null;
			this.fieldValues = {};
			this.hideFieldsGroup();
			this.updateButtonState();
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
				console.warn('Failed to parse server_config:', e);
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
	}

	renderFields() {
		const fieldsGroup = this.querySelector("[data-fields-group]");
		const fieldsContainer = this.querySelector("[data-fields-container]");
		if (!fieldsGroup || !fieldsContainer) return;

		if (!this.selectedMethod || !this.selectedMethod.fields) {
			fieldsGroup.style.display = 'none';
			return;
		}

		fieldsContainer.innerHTML = '';
		const fields = this.selectedMethod.fields;

		if (Object.keys(fields).length === 0) {
			fieldsGroup.style.display = 'none';
			return;
		}

		Object.keys(fields).forEach(fieldKey => {
			const field = fields[fieldKey];
			const fieldGroup = document.createElement('div');
			fieldGroup.className = 'form-group';

			const label = document.createElement('label');
			label.className = 'form-label';
			label.htmlFor = `field-${fieldKey}`;
			// Append text and asterisk inline
			label.appendChild(document.createTextNode(field.label || fieldKey));
			if (field.required) {
				const required = document.createElement('span');
				required.className = 'field-required';
				required.textContent = ' *';
				label.appendChild(required);
			}

			let input;
			if (field.type === 'color') {
				input = document.createElement('input');
				input.type = 'color';
				input.id = `field-${fieldKey}`;
				input.name = fieldKey;
				input.className = 'form-input';
				// Set default color if not provided
				input.value = '#000000';
				if (field.required) {
					input.required = true;
				}
				// Initialize field value with default
				this.fieldValues[fieldKey] = input.value;
				input.addEventListener('change', (e) => {
					this.fieldValues[fieldKey] = e.target.value;
					this.updateButtonState();
				});
				// Also listen to input event for color pickers
				input.addEventListener('input', (e) => {
					this.fieldValues[fieldKey] = e.target.value;
					this.updateButtonState();
				});
			} else {
				input = document.createElement('input');
				input.type = field.type || 'text';
				input.id = `field-${fieldKey}`;
				input.name = fieldKey;
				input.className = 'form-input';
				input.placeholder = field.label || fieldKey;
				if (field.required) {
					input.required = true;
				}
				// Initialize field value
				this.fieldValues[fieldKey] = '';
				input.addEventListener('input', (e) => {
					this.fieldValues[fieldKey] = e.target.value;
					this.updateButtonState();
				});
				// Also listen to change event for text inputs
				input.addEventListener('change', (e) => {
					this.fieldValues[fieldKey] = e.target.value;
					this.updateButtonState();
				});
			}

			fieldGroup.appendChild(label);
			fieldGroup.appendChild(input);
			fieldsContainer.appendChild(fieldGroup);
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
					console.warn('updateButtonState - Could not parse credits:', this.selectedMethod.credits);
				}
			} else {
				console.warn('updateButtonState - Credits is undefined or null, using default 0.5');
			}
		} else {
			console.warn('updateButtonState - No selectedMethod');
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
			console.error('Missing required data: server_id and method are required');
			return;
		}

		button.disabled = true;

		const creationToken = generateCreationToken();

		// Create pending creation item
		const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		const pendingItem = {
			id: pendingId,
			status: "pending",
			created_at: new Date().toISOString(),
			creation_token: creationToken
		};
		const pendingKey = "pendingCreations";
		const pendingList = JSON.parse(sessionStorage.getItem(pendingKey) || "[]");
		pendingList.unshift(pendingItem);
		sessionStorage.setItem(pendingKey, JSON.stringify(pendingList));

		document.dispatchEvent(new CustomEvent("creations-pending-updated"));
		const creationsRoute = document.querySelector("app-route-creations");
		if (creationsRoute && typeof creationsRoute.loadCreations === "function") {
			await creationsRoute.loadCreations();
		}

		// Navigate to Creations page immediately (optimistic UI)
		const header = document.querySelector('app-navigation');
		if (header && typeof header.handleRouteChange === 'function') {
			window.history.pushState({ route: 'creations' }, '', '/creations');
			header.handleRouteChange();
		} else {
			// Fallback: use hash-based routing
			window.location.hash = 'creations';
		}

		// Make API call to create image
		fetch("/api/create", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			credentials: "include",
			body: JSON.stringify({
				server_id: this.selectedServer.id,
				method: methodKey,
				args: collectedArgs || {},
				creation_token: creationToken
			})
		})
			.then(async (response) => {
				if (!response.ok) {
					const error = await response.json();
					// Handle insufficient credits error specifically
					if (response.status === 402) {
						// Refresh credits to get updated balance
						document.dispatchEvent(new CustomEvent('credits-updated', {
							detail: { count: error.current ?? 0 }
						}));
						// Trigger credits refresh in create component
						await this.loadCredits();
						throw new Error(error.message || "Insufficient credits");
					}
					throw new Error(error.error || "Failed to create image");
				}
				const data = await response.json();
				// Update credits if returned in response
				if (typeof data.credits_remaining === 'number') {
					document.dispatchEvent(new CustomEvent('credits-updated', {
						detail: { count: data.credits_remaining }
					}));
				}
				return null;
			})
			.then(() => {
				const current = JSON.parse(sessionStorage.getItem(pendingKey) || "[]");
				const next = current.filter(item => item.id !== pendingId);
				sessionStorage.setItem(pendingKey, JSON.stringify(next));
				document.dispatchEvent(new CustomEvent("creations-pending-updated"));
			})
			.catch(async (error) => {
				const current = JSON.parse(sessionStorage.getItem(pendingKey) || "[]");
				const next = current.filter(item => item.id !== pendingId);
				sessionStorage.setItem(pendingKey, JSON.stringify(next));
				document.dispatchEvent(new CustomEvent("creations-pending-updated"));
				console.error("Error creating image:", error);
				// Refresh credits display in case of error
				await this.loadCredits();
			})
			.finally(() => {
				button.disabled = false;
			});
	}
}

customElements.define("app-route-create", AppRouteCreate);
