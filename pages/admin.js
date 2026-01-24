const adminDataLoaded = {
	users: false,
	moderation: false,
	providers: false,
	policies: false,
	todo: false
};
let todoWritable = true;
let todoPriorityMode = "pre";

function getDialColor(value) {
	const clamped = Math.max(0, Math.min(100, Number(value) || 0));
	let hue;
	if (clamped <= 20) {
		hue = 0;
	} else if (clamped <= 50) {
		const t = (clamped - 20) / 30;
		hue = 0 + t * 30;
	} else {
		const t = (clamped - 50) / 50;
		hue = 30 + t * 90;
	}
	return `hsl(${hue} 70% 50%)`;
}

function applyDialStyles(dial, value) {
	if (!dial) return;
	const dialColor = getDialColor(value);
	const dialPercent = Math.max(0, Math.min(100, Number(value) || 0));
	dial.textContent = value ?? "0";
	dial.style.setProperty("--dial-color", dialColor);
	dial.style.setProperty("--dial-percent", `${dialPercent}%`);
}

function renderEmpty(container, message) {
	const empty = document.createElement("div");
	empty.className = "admin-empty";
	empty.textContent = message;
	container.appendChild(empty);
}

function renderError(container, message) {
	const error = document.createElement("div");
	error.className = "admin-error";
	error.textContent = message;
	container.appendChild(error);
}

async function loadUsers() {
	const container = document.querySelector("#users-container");
	if (!container) return;
	if (adminDataLoaded.users) return;

	try {
		const response = await fetch("/admin/users", {
			credentials: 'include'
		});
		if (!response.ok) throw new Error("Failed to load users.");
		const data = await response.json();

		container.innerHTML = "";
		if (!data.users || data.users.length === 0) {
			renderEmpty(container, "No users yet.");
			return;
		}

		for (const user of data.users) {
			const card = document.createElement("div");
			card.className = "card user-card";

			const email = document.createElement("div");
			email.className = "user-email";
			email.textContent = user.email;

			const details = document.createElement("div");
			details.className = "user-details";

			const role = document.createElement("span");
			role.className = "user-role";
			role.textContent = user.role;

			const credits = document.createElement("span");
			credits.className = "user-credits";
			const creditsValue = typeof user.credits === 'number' ? user.credits : 0;
			credits.textContent = `${creditsValue.toFixed(1)} credits`;

			const created = document.createElement("div");
			created.className = "user-created";
			created.textContent = user.created_at;

			details.appendChild(role);
			details.appendChild(document.createTextNode(" • "));
			details.appendChild(credits);

			card.appendChild(email);
			card.appendChild(details);
			card.appendChild(created);

			container.appendChild(card);
		}
		adminDataLoaded.users = true;
	} catch (err) {
		container.innerHTML = "";
		renderError(container, "Error loading users.");
	}
}

async function loadModeration() {
	const container = document.querySelector("#moderation-container");
	if (!container) return;
	if (adminDataLoaded.moderation) return;

	try {
		const response = await fetch("/admin/moderation", {
			credentials: 'include'
		});
		if (!response.ok) throw new Error("Failed to load moderation queue.");
		const data = await response.json();

		container.innerHTML = "";
		if (!data.items || data.items.length === 0) {
			renderEmpty(container, "No moderation items.");
			return;
		}

		for (const item of data.items) {
			const card = document.createElement("div");
			card.className = "card admin-card";

			const title = document.createElement("div");
			title.className = "admin-title";
			title.textContent = `${item.content_type}: ${item.content_id}`;

			const meta = document.createElement("div");
			meta.className = "admin-meta";
			meta.textContent = `Status: ${item.status}`;

			const reason = document.createElement("div");
			reason.className = "admin-detail";
			reason.textContent = item.reason || "No reason provided.";

			const created = document.createElement("div");
			created.className = "admin-timestamp";
			created.textContent = item.created_at;

			card.appendChild(title);
			card.appendChild(meta);
			card.appendChild(reason);
			card.appendChild(created);

			container.appendChild(card);
		}
		adminDataLoaded.moderation = true;
	} catch (err) {
		container.innerHTML = "";
		renderError(container, "Error loading moderation.");
	}
}

function renderProviderCapabilities(container, capabilities) {
	const methodsContainer = document.createElement("div");
	methodsContainer.className = "provider-capabilities";
	methodsContainer.style.marginTop = "1rem";
	methodsContainer.style.padding = "1rem";
	methodsContainer.style.background = "var(--surface-strong, #f5f5f5)";
	methodsContainer.style.borderRadius = "8px";

	const methodsTitle = document.createElement("h4");
	methodsTitle.textContent = "Available Generation Methods";
	methodsTitle.style.marginTop = "0";
	methodsTitle.style.marginBottom = "1rem";
	methodsContainer.appendChild(methodsTitle);

	const methods = capabilities.methods || {};
	const methodKeys = Object.keys(methods);

	if (methodKeys.length === 0) {
		const noMethods = document.createElement("div");
		noMethods.textContent = "No generation methods available.";
		noMethods.style.color = "var(--text-muted, #666)";
		methodsContainer.appendChild(noMethods);
	} else {
		methodKeys.forEach(methodKey => {
			const method = methods[methodKey];
			const methodCard = document.createElement("div");
			methodCard.style.marginBottom = "1rem";
			methodCard.style.padding = "12px 14px";
			methodCard.style.background = "var(--surface, #fff)";
			methodCard.style.borderRadius = "8px";
			methodCard.style.border = "1px solid var(--border, #ddd)";

			const methodName = document.createElement("div");
			methodName.style.fontWeight = "600";
			methodName.style.marginBottom = "0.25rem";
			methodName.textContent = method.name || methodKey;
			methodCard.appendChild(methodName);

			const methodDesc = document.createElement("div");
			methodDesc.style.fontSize = "0.875rem";
			methodDesc.style.color = "var(--text-muted, #666)";
			methodDesc.style.marginBottom = "0.5rem";
			methodDesc.textContent = method.description || "No description";
			methodCard.appendChild(methodDesc);

			const fields = method.fields || {};
			const fieldKeys = Object.keys(fields);
			if (fieldKeys.length > 0) {
				const fieldsTitle = document.createElement("div");
				fieldsTitle.style.fontSize = "0.75rem";
				fieldsTitle.style.fontWeight = "600";
				fieldsTitle.style.marginTop = "0.5rem";
				fieldsTitle.style.marginBottom = "0.25rem";
				fieldsTitle.textContent = "Fields:";
				methodCard.appendChild(fieldsTitle);

				fieldKeys.forEach(fieldKey => {
					const field = fields[fieldKey];
					const fieldItem = document.createElement("div");
					fieldItem.style.fontSize = "0.75rem";
					fieldItem.style.marginLeft = "0.75rem";
					fieldItem.style.marginBottom = "0.25rem";

					const requiredBadge = field.required ? " (required)" : " (optional)";
					fieldItem.textContent = `${field.label || fieldKey} (${field.type || 'text'})${requiredBadge}`;
					methodCard.appendChild(fieldItem);
				});
			}

			methodsContainer.appendChild(methodCard);
		});
	}

	container.appendChild(methodsContainer);
}

async function loadProviders() {
	const container = document.querySelector("#providers-container");
	if (!container) return;
	if (adminDataLoaded.providers) return;

	try {
		const response = await fetch("/admin/providers", {
			credentials: 'include'
		});
		if (!response.ok) throw new Error("Failed to load providers.");
		const data = await response.json();

		container.innerHTML = "";
		if (!data.providers || data.providers.length === 0) {
			renderEmpty(container, "No providers registered.");
			return;
		}

		for (const provider of data.providers) {
			const card = document.createElement("div");
			card.className = "card admin-card";
			card.style.cursor = "pointer";
			card.dataset.serverId = provider.id;

			const name = document.createElement("div");
			name.className = "admin-title";
			name.textContent = provider.name || "Unnamed Server";

			const meta = document.createElement("div");
			meta.className = "admin-meta";
			meta.textContent = `${provider.status}`;
			if (provider.owner_email) {
				meta.textContent += ` • ${provider.owner_email}`;
			}

			if (provider.server_url) {
				const serverUrl = document.createElement("div");
				serverUrl.className = "admin-detail";
				serverUrl.style.fontSize = "0.875rem";
				serverUrl.textContent = provider.server_url;
				card.appendChild(serverUrl);
			}

			const created = document.createElement("div");
			created.className = "admin-timestamp";
			created.textContent = provider.created_at;

			card.appendChild(name);
			card.appendChild(meta);
			card.appendChild(created);

			card.addEventListener("click", () => {
				openServerModal(provider.id);
			});

			container.appendChild(card);
		}
		adminDataLoaded.providers = true;
	} catch (err) {
		container.innerHTML = "";
		renderError(container, "Error loading providers.");
	}
}

async function loadPolicies() {
	const container = document.querySelector("#policies-container");
	if (!container) return;
	if (adminDataLoaded.policies) return;

	try {
		const response = await fetch("/admin/policies", {
			credentials: 'include'
		});
		if (!response.ok) throw new Error("Failed to load policies.");
		const data = await response.json();

		container.innerHTML = "";
		if (!data.policies || data.policies.length === 0) {
			renderEmpty(container, "No policies configured.");
			return;
		}

		for (const policy of data.policies) {
			const card = document.createElement("div");
			card.className = "card admin-card";

			const key = document.createElement("div");
			key.className = "admin-title";
			key.textContent = policy.key;

			const value = document.createElement("div");
			value.className = "admin-meta";
			value.textContent = policy.value;

			const description = document.createElement("div");
			description.className = "admin-detail";
			description.textContent = policy.description || "No description.";

			const updated = document.createElement("div");
			updated.className = "admin-timestamp";
			updated.textContent = policy.updated_at;

			card.appendChild(key);
			card.appendChild(value);
			card.appendChild(description);
			card.appendChild(updated);

			container.appendChild(card);
		}
		adminDataLoaded.policies = true;
	} catch (err) {
		container.innerHTML = "";
		renderError(container, "Error loading policies.");
	}
}

function renderTodoRows(container, items, writable) {
	container.innerHTML = "";
	const sortedItems = [...items].sort((a, b) => b.priority - a.priority);

	if (!sortedItems.length) {
		const item = document.createElement("div");
		item.className = "todo-loading";
		item.textContent = "No todo items yet.";
		container.appendChild(item);
	}

	sortedItems.forEach((item, index) => {
		const row = document.createElement("div");
		row.className = "todo-card";
		if (index === sortedItems.length - 1) {
			row.classList.add("todo-card-last");
		}
		row.dataset.itemName = item.name;
		row.dataset.itemDescription = item.description || "";
		row.dataset.itemTime = item.time;
		row.dataset.itemImpact = item.impact;

		const card = document.createElement("div");
		card.className = "todo-card-inner";

		const header = document.createElement("div");
		header.className = "todo-card-header";

		const title = document.createElement("div");
		title.className = "todo-card-title";
		title.textContent = item.name;

		const description = document.createElement("div");
		description.className = "todo-card-description";
		description.textContent = item.description || "";

		const text = document.createElement("div");
		text.className = "todo-card-text";
		text.appendChild(title);
		text.appendChild(description);

		const dial = document.createElement("div");
		dial.className = "todo-card-dial";
		dial.textContent = item.priority;
		applyDialStyles(dial, item.priority);

		header.appendChild(text);
		header.appendChild(dial);

		card.appendChild(header);
		row.appendChild(card);
		container.appendChild(row);
	});

	if (writable) {
		const ghostRow = document.createElement("div");
		ghostRow.className = "todo-card todo-card-ghost";
		const ghostButton = document.createElement("button");
		ghostButton.type = "button";
		ghostButton.className = "todo-ghost";
		ghostButton.textContent = "Add new item";
		ghostButton.dataset.todoAdd = "true";
		ghostRow.appendChild(ghostButton);
		container.appendChild(ghostRow);
	}
}

async function loadTodo({ force = false, mode } = {}) {
	const body = document.querySelector("#todo-list");
	const alert = document.querySelector("#todo-alert");
	const modal = document.querySelector("#todo-modal");
	const modalForm = document.querySelector("#todo-modal-form");
	if (!body || !modal) return;
	if (adminDataLoaded.todo && !force) return;

	try {
		const priorityMode = mode ? (mode === "post" ? "post" : "pre") : todoPriorityMode;
		const query = new URLSearchParams({ mode: priorityMode });
		const response = await fetch(`/api/todo?${query.toString()}`, {
			credentials: "include"
		});
		if (!response.ok) throw new Error("Failed to load todo.");
		const data = await response.json();
		const writable = data.writable !== false;
		todoWritable = writable;
		renderTodoRows(body, Array.isArray(data.items) ? data.items : [], writable);

		if (alert) {
			alert.hidden = writable;
		}
		body.querySelectorAll("button").forEach((el) => {
			el.disabled = !writable;
		});
		if (modalForm) {
			modalForm.querySelectorAll("input, textarea, button").forEach((el) => {
				el.disabled = !writable;
			});
		}
		adminDataLoaded.todo = true;
	} catch (err) {
		body.innerHTML = "";
		const item = document.createElement("div");
		item.className = "todo-loading";
		item.textContent = "Error loading todo.";
		body.appendChild(item);
	}
}

function handleAdminRouteChange(route) {
	const normalizedRoute = route === "providers"
		? "provider-registry"
		: route === "policies"
			? "policy-knobs"
			: route;

	switch (normalizedRoute) {
		case "moderation":
			loadModeration();
			break;
		case "provider-registry":
			loadProviders();
			break;
		case "policy-knobs":
			loadPolicies();
			break;
		case "todo":
			loadTodo();
			break;
		case "users":
		default:
			loadUsers();
			break;
	}
}

const adminHeader = document.querySelector("app-header");
if (adminHeader) {
	adminHeader.addEventListener("route-change", (event) => {
		handleAdminRouteChange(event.detail?.route);
	});
}

const initialRoute =
	window.location.pathname === "/" || window.location.pathname === ""
		? "users"
		: window.location.pathname.slice(1);
handleAdminRouteChange(initialRoute);

const todoModal = document.querySelector("#todo-modal");
const todoModalForm = document.querySelector("#todo-modal-form");
const todoReadonlyModal = document.querySelector("#todo-readonly-modal");
const todoReadonlyTitle = document.querySelector("#todo-readonly-title");
const todoReadonlyDescription = document.querySelector("[data-todo-readonly-description]");
const todoReadonlyTimeDial = document.querySelector('[data-todo-readonly-dial="time"]');
const todoReadonlyImpactDial = document.querySelector('[data-todo-readonly-dial="impact"]');

function openTodoModal({ mode, item }) {
	if (!todoModal || !todoModalForm) return;
	todoModal.classList.add("open");
	const submit = todoModal.querySelector(".todo-modal-submit");
	const deleteButton = todoModal.querySelector(".todo-modal-delete");
	const title = todoModal.querySelector("#todo-modal-title");
	if (submit) submit.textContent = mode === "edit" ? "Save changes" : "Add item";
	if (title) title.textContent = mode === "edit" ? "Edit Todo Item" : "Add Todo Item";
	if (deleteButton) {
		deleteButton.hidden = mode !== "edit";
	}

	todoModalForm.reset();
	todoModalForm.elements.mode.value = mode;
	todoModalForm.elements.originalName.value = item?.name || "";
	todoModalForm.elements.name.value = item?.name || "";
	todoModalForm.elements.description.value = item?.description || "";
	todoModalForm.elements.time.value = item?.time || 50;
	todoModalForm.elements.impact.value = item?.impact || 50;
	todoModalForm.dataset.initial = JSON.stringify({
		name: todoModalForm.elements.name.value,
		description: todoModalForm.elements.description.value,
		time: String(todoModalForm.elements.time.value),
		impact: String(todoModalForm.elements.impact.value)
	});
	updateTodoSaveState();
	updateTodoSliderValues();
}

function closeTodoModal() {
	if (!todoModal) return;
	todoModal.classList.remove("open");
}

function openTodoReadonlyModal(item) {
	if (!todoReadonlyModal) return;
	if (todoReadonlyTitle) {
		todoReadonlyTitle.textContent = item?.name || "Todo item";
	}
	if (todoReadonlyDescription) {
		todoReadonlyDescription.textContent = item?.description || "No description provided.";
	}
	applyDialStyles(todoReadonlyTimeDial, item?.time ?? 0);
	applyDialStyles(todoReadonlyImpactDial, item?.impact ?? 0);
	todoReadonlyModal.classList.add("open");
}

function closeTodoReadonlyModal() {
	if (!todoReadonlyModal) return;
	todoReadonlyModal.classList.remove("open");
}

if (todoModal) {
	todoModal.addEventListener("click", (event) => {
		if (event.target?.dataset?.todoClose !== undefined || event.target === todoModal) {
			closeTodoModal();
		}
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && todoModal.classList.contains("open")) {
			closeTodoModal();
		}
	});
}

if (todoReadonlyModal) {
	todoReadonlyModal.addEventListener("click", (event) => {
		if (event.target?.dataset?.todoReadonlyClose !== undefined || event.target === todoReadonlyModal) {
			closeTodoReadonlyModal();
		}
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && todoReadonlyModal.classList.contains("open")) {
			closeTodoReadonlyModal();
		}
	});
}

const todoList = document.querySelector("#todo-list");
if (todoList) {
	todoList.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		if (target.dataset.todoAdd !== undefined) {
			openTodoModal({ mode: "add" });
			return;
		}
		const card = target.closest(".todo-card");
		if (card && !card.querySelector(".todo-ghost")) {
			if (!todoWritable) {
				openTodoReadonlyModal({
					name: card.dataset.itemName,
					description: card.dataset.itemDescription,
					time: card.dataset.itemTime,
					impact: card.dataset.itemImpact
				});
				return;
			}
			openTodoModal({
				mode: "edit",
				item: {
					name: card.dataset.itemName,
					description: card.dataset.itemDescription,
					time: card.dataset.itemTime,
					impact: card.dataset.itemImpact
				}
			});
		}
	});
}

const todoModeToggle = document.querySelector("[data-todo-mode-toggle]");
const todoModeButtons = todoModeToggle
	? Array.from(todoModeToggle.querySelectorAll("[data-todo-mode]"))
	: [];

function setTodoPriorityMode(mode) {
	todoPriorityMode = mode === "post" ? "post" : "pre";
	todoModeButtons.forEach((button) => {
		const isActive = button.dataset.todoMode === todoPriorityMode;
		button.classList.toggle("is-active", isActive);
		button.setAttribute("aria-pressed", String(isActive));
	});
}

if (todoModeButtons.length) {
	setTodoPriorityMode(todoPriorityMode);
	todoModeButtons.forEach((button) => {
		button.addEventListener("click", () => {
			const nextMode = button.dataset.todoMode;
			if (!nextMode || nextMode === todoPriorityMode) return;
			setTodoPriorityMode(nextMode);
			adminDataLoaded.todo = false;
			loadTodo({ force: true, mode: todoPriorityMode });
		});
	});
}

if (todoModalForm) {
	todoModalForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (todoModalForm.querySelector(".todo-modal-submit")?.disabled) {
			return;
		}
		const payload = {
			name: todoModalForm.elements.name.value,
			description: todoModalForm.elements.description.value,
			time: Number(todoModalForm.elements.time.value),
			impact: Number(todoModalForm.elements.impact.value)
		};
		const mode = todoModalForm.elements.mode.value;
		if (mode === "edit") {
			payload.originalName = todoModalForm.elements.originalName.value;
		}

		try {
			const response = await fetch("/api/todo", {
				method: mode === "edit" ? "PUT" : "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
				credentials: "include"
			});
			if (!response.ok) {
				const error = await response.json().catch(() => ({}));
				throw new Error(error.error || "Failed to save todo item.");
			}
			closeTodoModal();
			adminDataLoaded.todo = false;
			loadTodo({ force: true });
		} catch (err) {
			alert(err.message || "Failed to save todo item.");
		}
	});
}

const todoDeleteButton = document.querySelector(".todo-modal-delete");
if (todoDeleteButton) {
	todoDeleteButton.addEventListener("click", async () => {
		if (!todoModalForm) return;
		const name = todoModalForm.elements.originalName.value;
		if (!name) return;
		const confirmed = window.confirm(`Delete "${name}"?`);
		if (!confirmed) return;
		try {
			const response = await fetch("/api/todo", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name }),
				credentials: "include"
			});
			if (!response.ok) {
				const error = await response.json().catch(() => ({}));
				throw new Error(error.error || "Failed to delete todo item.");
			}
			closeTodoModal();
			adminDataLoaded.todo = false;
			loadTodo({ force: true });
		} catch (err) {
			alert(err.message || "Failed to delete todo item.");
		}
	});
}

function updateTodoSliderValues() {
	if (!todoModalForm) return;
	const costValue = todoModalForm.querySelector('[data-slider-value="time"]');
	const impactValue = todoModalForm.querySelector('[data-slider-value="impact"]');
	if (costValue) costValue.textContent = todoModalForm.elements.time.value;
	if (impactValue) impactValue.textContent = todoModalForm.elements.impact.value;
}

function updateTodoSaveState() {
	if (!todoModalForm) return;
	const submit = todoModalForm.querySelector(".todo-modal-submit");
	if (!submit) return;
	const initial = todoModalForm.dataset.initial
		? JSON.parse(todoModalForm.dataset.initial)
		: null;
	const current = {
		name: todoModalForm.elements.name.value,
		description: todoModalForm.elements.description.value,
		time: String(todoModalForm.elements.time.value),
		impact: String(todoModalForm.elements.impact.value)
	};
	const hasChanges = !initial
		|| initial.name !== current.name
		|| initial.description !== current.description
		|| initial.time !== current.time
		|| initial.impact !== current.impact;
	submit.disabled = !hasChanges;
}

if (todoModalForm) {
	todoModalForm.addEventListener("input", (event) => {
		const target = event.target;
		if (target instanceof HTMLInputElement && (target.name === "time" || target.name === "impact")) {
			updateTodoSliderValues();
		}
		updateTodoSaveState();
	});
	todoModalForm.addEventListener("change", () => {
		updateTodoSaveState();
	});
}

// Server Modal Functions
const serverModal = document.querySelector("#server-modal");
const serverModalContent = document.querySelector("#server-modal-content");
const serverModalTitle = document.querySelector("#server-modal-title");
let currentServerId = null;

function openServerModal(serverId) {
	if (!serverModal || !serverModalContent) return;
	currentServerId = serverId;
	serverModal.classList.add("open");
	loadServerDetails(serverId);
}

function closeServerModal() {
	if (!serverModal) return;
	serverModal.classList.remove("open");
}

async function loadServerDetails(serverId) {
	if (!serverModalContent) return;
	serverModalContent.innerHTML = '<div class="server-loading">Loading...</div>';

	try {
		const response = await fetch(`/admin/servers/${serverId}`, {
			credentials: 'include'
		});
		if (!response.ok) throw new Error("Failed to load server details.");
		const data = await response.json();
		const server = data.server;

		if (serverModalTitle) {
			serverModalTitle.textContent = server.name || "Server Details";
		}

		renderServerDetails(server);
	} catch (err) {
		serverModalContent.innerHTML = `<div class="admin-error">Error loading server details: ${err.message}</div>`;
	}
}

function renderServerDetails(server) {
	if (!serverModalContent) return;

	const html = `
		<div class="server-details">
			<div class="server-detail-row">
				<strong>Status:</strong> <span>${server.status || '—'}</span>
			</div>
			<div class="server-detail-row">
				<strong>Server URL:</strong> <span>${server.server_url || '—'}</span>
			</div>
			${server.owner_email ? `<div class="server-detail-row"><strong>Owner:</strong> <span>${server.owner_email}</span></div>` : ''}
			${server.description ? `<div class="server-detail-row"><strong>Description:</strong> <span>${server.description}</span></div>` : ''}
			<div class="server-detail-row">
				<strong>Members:</strong> <span>${server.members_count || 0}</span>
			</div>
			<div class="server-detail-row">
				<strong>Created:</strong> <span>${server.created_at || '—'}</span>
			</div>
			${server.updated_at ? `<div class="server-detail-row"><strong>Last Updated:</strong> <span>${server.updated_at}</span></div>` : ''}
		</div>
		<div id="server-capabilities-container" class="server-capabilities-container"></div>
	`;

	serverModalContent.innerHTML = html;

	// Render existing capabilities if available
	if (server.server_config) {
		renderServerCapabilities(server.server_config);
	}

	// Setup button handlers - remove old listeners and add new ones
	const testBtn = document.querySelector("#server-test-btn");
	const refreshBtn = document.querySelector("#server-refresh-btn");

	if (testBtn) {
		const newTestBtn = testBtn.cloneNode(true);
		testBtn.replaceWith(newTestBtn);
		newTestBtn.addEventListener("click", () => {
			if (currentServerId) testServer(currentServerId);
		});
	}
	if (refreshBtn) {
		const newRefreshBtn = refreshBtn.cloneNode(true);
		refreshBtn.replaceWith(newRefreshBtn);
		newRefreshBtn.addEventListener("click", () => {
			if (currentServerId) refreshServerMethods(currentServerId);
		});
	}
}

function renderServerCapabilities(capabilities) {
	const container = document.querySelector("#server-capabilities-container");
	if (!container) return;

	if (!capabilities || !capabilities.methods) {
		container.innerHTML = '<div class="server-capabilities-empty">No capabilities data available.</div>';
		return;
	}

	renderProviderCapabilities(container, capabilities);
}

async function testServer(serverId) {
	const testBtn = document.querySelector("#server-test-btn");
	const capabilitiesContainer = document.querySelector("#server-capabilities-container");

	if (!testBtn || !capabilitiesContainer) return;

	const originalText = testBtn.textContent;
	testBtn.disabled = true;
	testBtn.textContent = "Testing...";
	capabilitiesContainer.innerHTML = '<div class="server-loading">Testing server...</div>';

	try {
		const response = await fetch(`/admin/servers/${serverId}/test`, {
			method: 'POST',
			credentials: 'include'
		});

		const data = await response.json();

		if (!response.ok) {
			capabilitiesContainer.innerHTML = `<div class="admin-error">Error: ${data.error || 'Failed to test server'}</div>`;
		} else {
			capabilitiesContainer.innerHTML = '<div class="server-success">✓ Server is accessible and responding</div>';
			renderProviderCapabilities(capabilitiesContainer, data.capabilities);
		}
	} catch (err) {
		capabilitiesContainer.innerHTML = `<div class="admin-error">Error: ${err.message || 'Failed to test server'}</div>`;
	} finally {
		testBtn.disabled = false;
		testBtn.textContent = originalText;
	}
}

async function refreshServerMethods(serverId) {
	const refreshBtn = document.querySelector("#server-refresh-btn");
	const capabilitiesContainer = document.querySelector("#server-capabilities-container");

	if (!refreshBtn || !capabilitiesContainer) return;

	const originalText = refreshBtn.textContent;
	refreshBtn.disabled = true;
	refreshBtn.textContent = "Refreshing...";
	capabilitiesContainer.innerHTML = '<div class="server-loading">Refreshing server methods...</div>';

	try {
		const response = await fetch(`/admin/servers/${serverId}/refresh`, {
			method: 'POST',
			credentials: 'include'
		});

		const data = await response.json();

		if (!response.ok) {
			capabilitiesContainer.innerHTML = `<div class="admin-error">Error: ${data.error || 'Failed to refresh server methods'}</div>`;
		} else {
			capabilitiesContainer.innerHTML = '<div class="server-success">✓ Server methods refreshed successfully</div>';
			renderProviderCapabilities(capabilitiesContainer, data.capabilities);
			// Reload server details to show updated timestamp
			loadServerDetails(serverId);
		}
	} catch (err) {
		capabilitiesContainer.innerHTML = `<div class="admin-error">Error: ${err.message || 'Failed to refresh server methods'}</div>`;
	} finally {
		refreshBtn.disabled = false;
		refreshBtn.textContent = originalText;
	}
}

if (serverModal) {
	serverModal.addEventListener("click", (event) => {
		if (event.target?.dataset?.serverClose !== undefined || event.target === serverModal) {
			closeServerModal();
		}
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && serverModal.classList.contains("open")) {
			closeServerModal();
		}
	});
}