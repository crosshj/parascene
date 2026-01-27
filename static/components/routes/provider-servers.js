const html = String.raw;

function renderProviderCapabilities(container, capabilities) {
	const methodsContainer = document.createElement("div");
	methodsContainer.className = "provider-capabilities";

	const methodsTitle = document.createElement("h4");
	methodsTitle.textContent = "Available Generation Methods";
	methodsContainer.appendChild(methodsTitle);

	const methods = capabilities.methods || {};
	const methodKeys = Object.keys(methods);

	if (methodKeys.length === 0) {
		const noMethods = document.createElement("div");
		noMethods.style.padding = "1rem";
		noMethods.style.textAlign = "center";
		noMethods.style.color = "var(--text-muted)";
		noMethods.textContent = "No generation methods available.";
		methodsContainer.appendChild(noMethods);
	} else {
		methodKeys.forEach(methodKey => {
			const method = methods[methodKey];
			const methodCard = document.createElement("div");
			methodCard.className = "method-card";

			const methodName = document.createElement("div");
			methodName.className = "method-name";
			methodName.textContent = method.name || methodKey;
			methodCard.appendChild(methodName);

			const methodDesc = document.createElement("div");
			methodDesc.className = "method-desc";
			methodDesc.textContent = method.description || "No description";
			methodCard.appendChild(methodDesc);

			const fields = method.fields || {};
			const fieldKeys = Object.keys(fields);
			if (fieldKeys.length > 0) {
				const fieldsSection = document.createElement("div");
				fieldsSection.className = "fields-section";

				const fieldsTitle = document.createElement("div");
				fieldsTitle.className = "fields-title";
				fieldsTitle.textContent = "Fields";
				fieldsSection.appendChild(fieldsTitle);

				const fieldList = document.createElement("div");
				fieldList.className = "field-list";

				fieldKeys.forEach(fieldKey => {
					const field = fields[fieldKey];
					const fieldItem = document.createElement("div");
					fieldItem.className = "field-item";

					const fieldLabel = document.createElement("span");
					fieldLabel.className = "field-label";
					fieldLabel.textContent = field.label || fieldKey;
					fieldItem.appendChild(fieldLabel);

					const fieldType = document.createElement("span");
					fieldType.className = "field-type";
					fieldType.textContent = field.type || 'text';
					fieldItem.appendChild(fieldType);

					const fieldBadge = document.createElement("span");
					fieldBadge.className = `field-badge ${field.required ? 'required' : 'optional'}`;
					fieldBadge.textContent = field.required ? 'Required' : 'Optional';
					fieldItem.appendChild(fieldBadge);

					fieldList.appendChild(fieldItem);
				});

				fieldsSection.appendChild(fieldList);
				methodCard.appendChild(fieldsSection);
			}

			methodsContainer.appendChild(methodCard);
		});
	}

	container.appendChild(methodsContainer);
}

class AppRouteProviderServers extends HTMLElement {
	connectedCallback() {
		this.innerHTML = html`
      <style>
        .provider-register-form {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          margin-top: 1.5rem;
        }
        .provider-register-form input {
          width: 100%;
          padding: 0.75rem 1rem;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--input-bg);
          color: var(--text);
          font-size: 0.95rem;
          font-family: inherit;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .provider-register-form input:focus-visible {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
        }
        .provider-register-form input::placeholder {
          color: var(--text-muted);
        }
        .provider-register-buttons {
          display: flex;
          gap: 0.75rem;
          margin-top: 0.5rem;
        }
        .provider-register-buttons button {
          flex: 1;
          padding: 0.875rem 1.5rem;
          border-radius: 8px;
          border: none;
          font-size: 0.95rem;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: background 0.2s ease, transform 0.1s ease, opacity 0.2s ease;
        }
        .provider-register-buttons button[type="button"] {
          background: var(--surface-strong);
          color: var(--text);
          border: 1px solid var(--border);
        }
        .provider-register-buttons button[type="button"]:hover:not(:disabled) {
          background: var(--surface);
          transform: translateY(-1px);
        }
        .provider-register-buttons button[type="submit"] {
          background: var(--accent);
          color: var(--accent-text);
        }
        .provider-register-buttons button[type="submit"]:hover:not(:disabled) {
          background: var(--focus);
          transform: translateY(-1px);
        }
        .provider-register-buttons button:active:not(:disabled) {
          transform: translateY(0);
        }
        .provider-register-buttons button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none !important;
        }
        #test-results-container {
          margin-top: 2rem;
          animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .success-indicator {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.9rem;
          color: var(--text-muted);
          margin-bottom: 1.5rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid var(--border);
        }
        .success-indicator .check-icon {
          color: var(--accent);
          font-weight: 600;
        }
        .provider-test-results.error {
          padding: 1.25rem;
          border-radius: 12px;
          background: var(--error-bg);
          border: 1px solid var(--error-border);
          color: var(--error-text);
        }
        .provider-test-results.error .error-message {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: 600;
        }
        .provider-capabilities {
          margin-top: 1.25rem;
          padding: 0;
        }
        .provider-capabilities h4 {
          margin: 0 0 1rem 0;
          font-size: 1rem;
          font-weight: 600;
          color: var(--text);
        }
        .method-card {
          margin-bottom: 1rem;
          padding: 1.25rem;
          background: var(--surface);
          border-radius: 10px;
          border: 1px solid var(--border);
          transition: box-shadow 0.2s ease, transform 0.2s ease;
        }
        .method-card:hover {
          box-shadow: var(--shadow);
          transform: translateY(-2px);
        }
        .method-card:last-child {
          margin-bottom: 0;
        }
        .method-name {
          font-weight: 600;
          font-size: 1.05rem;
          margin-bottom: 0.5rem;
          color: var(--text);
        }
        .method-desc {
          font-size: 0.9rem;
          color: var(--text-muted);
          margin-bottom: 1rem;
          line-height: 1.5;
        }
        .fields-section {
          margin-top: 1rem;
          padding-top: 1rem;
          border-top: 1px solid var(--border);
        }
        .fields-title {
          font-size: 0.8rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 0.75rem;
          color: var(--text-muted);
        }
        .field-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .field-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          padding: 0.5rem 0.75rem;
          background: var(--surface-strong);
          border-radius: 6px;
        }
        .field-label {
          font-weight: 500;
          color: var(--text);
        }
        .field-type {
          font-size: 0.8rem;
          padding: 0.125rem 0.5rem;
          background: var(--surface);
          border-radius: 4px;
          color: var(--text-muted);
          font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
        }
        .field-badge {
          font-size: 0.75rem;
          padding: 0.125rem 0.5rem;
          border-radius: 4px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .field-badge.required {
          background: color-mix(in srgb, var(--accent) 20%, transparent);
          color: var(--accent);
        }
        .field-badge.optional {
          background: var(--surface-strong);
          color: var(--text-muted);
        }
      </style>
      <div class="route-header">
        <h3>Register Server</h3>
        <p>Register your provider server to make it available for image generation.</p>
      </div>
      <div class="route-card">
        <form id="provider-register-form" class="provider-register-form">
          <input type="text" name="name" placeholder="Server Name" required />
          <input type="url" name="server_url" placeholder="Server URL (e.g., https://your-server.vercel.app/api)" required />
          <input type="text" name="auth_token" placeholder="Auth token (optional)" />
          <div class="provider-register-buttons">
            <button type="button" id="test-server-btn">Test Server</button>
            <button type="submit" id="register-btn">Register</button>
          </div>
        </form>
      </div>
      <div id="test-results-container"></div>
    `;

		const form = this.querySelector("#provider-register-form");
		const testButton = this.querySelector("#test-server-btn");
		const registerButton = this.querySelector("#register-btn");
		const urlInput = form.querySelector('input[name="server_url"]');
		const authInput = form.querySelector('input[name="auth_token"]');

		testButton.addEventListener("click", async () => {
			const serverUrl = urlInput.value.trim();
			const authToken = authInput ? authInput.value : "";
			if (!serverUrl) {
				alert("Please enter a server URL");
				return;
			}

			testButton.disabled = true;
			testButton.textContent = "Testing...";

			// Clear any existing test results
			const resultsContainer = this.querySelector("#test-results-container");
			if (resultsContainer) {
				resultsContainer.innerHTML = "";
			}

			try {
				const testResponse = await fetch("/api/provider/test", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ server_url: serverUrl, auth_token: authToken }),
					credentials: "include"
				});

				const testData = await testResponse.json();

				const resultsContainer = this.querySelector("#test-results-container");
				if (!resultsContainer) return;

				if (!testResponse.ok) {
					const resultsDiv = document.createElement("div");
					resultsDiv.className = "provider-test-results error";
					const errorMsg = document.createElement("div");
					errorMsg.className = "error-message";
					errorMsg.textContent = `✗ ${testData.error || "Failed to test server"}`;
					resultsDiv.appendChild(errorMsg);
					resultsContainer.appendChild(resultsDiv);
				} else {
					const successIndicator = document.createElement("div");
					successIndicator.className = "provider-test-results success-indicator";
					successIndicator.innerHTML = `<span class="check-icon">✓</span> <span>Server is accessible and responding</span>`;
					resultsContainer.appendChild(successIndicator);

					if (testData.capabilities) {
						renderProviderCapabilities(resultsContainer, testData.capabilities);
					}
				}
			} catch (err) {
				const resultsContainer = this.querySelector("#test-results-container");
				if (resultsContainer) {
					const resultsDiv = document.createElement("div");
					resultsDiv.className = "provider-test-results error";
					const errorMsg = document.createElement("div");
					errorMsg.className = "error-message";
					errorMsg.textContent = `✗ ${err.message || "Failed to test server"}`;
					resultsDiv.appendChild(errorMsg);
					resultsContainer.appendChild(resultsDiv);
				}
			} finally {
				testButton.disabled = false;
				testButton.textContent = "Test Server";
			}
		});

		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			const formData = new FormData(form);
			const payload = {
				name: formData.get("name"),
				server_url: formData.get("server_url"),
				auth_token: formData.get("auth_token")
			};

			registerButton.disabled = true;
			registerButton.textContent = "Registering...";

			try {
				const registerResponse = await fetch("/api/provider/register", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
					credentials: "include"
				});

				const registerData = await registerResponse.json();

				if (!registerResponse.ok) {
					alert(registerData.error || "Failed to register provider");
				} else {
					form.reset();
					const resultsContainer = this.querySelector("#test-results-container");
					if (resultsContainer) {
						resultsContainer.innerHTML = "";
					}
					alert("Provider registered successfully!");
				}
			} catch (err) {
				alert(err.message || "Failed to register provider");
			} finally {
				registerButton.disabled = false;
				registerButton.textContent = "Register";
			}
		});
	}
}

customElements.define("app-route-provider-servers", AppRouteProviderServers);
