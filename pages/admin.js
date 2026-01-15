async function loadUsers() {
  const tbody = document.querySelector("#users-table tbody");
  if (!tbody) return;

  try {
    const response = await fetch("/admin/users");
    if (!response.ok) throw new Error("Failed to load users.");
    const data = await response.json();

    tbody.innerHTML = "";
    if (!data.users || data.users.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.textContent = "No users yet.";
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    for (const user of data.users) {
      const row = document.createElement("tr");
      const id = document.createElement("td");
      id.textContent = user.id;
      const email = document.createElement("td");
      email.textContent = user.email;
      const role = document.createElement("td");
      role.textContent = user.role;
      const created = document.createElement("td");
      created.textContent = user.created_at;
      row.appendChild(id);
      row.appendChild(email);
      row.appendChild(role);
      row.appendChild(created);
      tbody.appendChild(row);
    }
  } catch (err) {
    tbody.innerHTML = "";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "Error loading users.";
    row.appendChild(cell);
    tbody.appendChild(row);
  }
}

loadUsers();
