const adminDataLoaded = {
  users: false,
  moderation: false,
  providers: false,
  policies: false,
  todo: false
};

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

      const created = document.createElement("div");
      created.className = "user-created";
      created.textContent = user.created_at;

      details.appendChild(role);

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

async function loadProviders() {
  const container = document.querySelector("#providers-container");
  if (!container) return;
  if (adminDataLoaded.providers) return;

  try {
    const response = await fetch("/admin/providers");
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

      const name = document.createElement("div");
      name.className = "admin-title";
      name.textContent = provider.name;

      const meta = document.createElement("div");
      meta.className = "admin-meta";
      meta.textContent = `${provider.status} • ${provider.region}`;

      const contact = document.createElement("div");
      contact.className = "admin-detail";
      contact.textContent = provider.contact_email;

      const created = document.createElement("div");
      created.className = "admin-timestamp";
      created.textContent = provider.created_at;

      card.appendChild(name);
      card.appendChild(meta);
      card.appendChild(contact);
      card.appendChild(created);

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

function renderTodoRows(container, items) {
  container.innerHTML = "";
  const sortedItems = [...items].sort((a, b) => b.priority - a.priority);

  const getDialColor = (value) => {
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
  };

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
    const dialColor = getDialColor(item.priority);
    const dialPercent = Math.max(0, Math.min(100, Number(item.priority) || 0));
    dial.style.setProperty("--dial-color", dialColor);
    dial.style.setProperty("--dial-percent", `${dialPercent}%`);

    header.appendChild(text);
    header.appendChild(dial);

    card.appendChild(header);
    row.appendChild(card);
    container.appendChild(row);
  });

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

async function loadTodo({ force = false } = {}) {
  const body = document.querySelector("#todo-list");
  const alert = document.querySelector("#todo-alert");
  const modal = document.querySelector("#todo-modal");
  const modalForm = document.querySelector("#todo-modal-form");
  if (!body || !alert || !modal) return;
  if (adminDataLoaded.todo && !force) return;

  try {
    const response = await fetch("/api/todo", {
      credentials: "include"
    });
    if (!response.ok) throw new Error("Failed to load todo.");
    const data = await response.json();
    renderTodoRows(body, Array.isArray(data.items) ? data.items : []);

    const writable = data.writable !== false;
    alert.hidden = writable;
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

function openTodoModal({ mode, item }) {
  if (!todoModal || !todoModalForm) return;
  todoModal.classList.add("open");
  const submit = todoModal.querySelector(".todo-modal-submit");
  const deleteButton = todoModal.querySelector(".todo-modal-delete");
  if (submit) submit.textContent = mode === "edit" ? "Save changes" : "Add item";
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