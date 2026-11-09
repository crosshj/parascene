import { loadAdminDataTable } from '/admin/shared/adminDataTable.js';

const table = document.querySelector('[data-todo-table]');
const dialog = document.querySelector('[data-todo-dialog]');
const form = document.querySelector('[data-todo-form]');
const title = document.querySelector('[data-todo-dialog-title]');
const errorMessage = document.querySelector('[data-todo-error]');
const dependencySelect = document.querySelector('[data-todo-dependency-select]');
const dependencyList = document.querySelector('[data-todo-dependencies]');
const formula = document.querySelector('[data-todo-formula]');
const readonlyDetails = document.querySelector('[data-todo-readonly]');
let writable = false;
const tableConfig = {
	fetchUrl: '/api/todo', itemsKey: 'items', pageSize: 25, defaultSortBy: 'priority', defaultSortDir: 'desc',
	emptyMessage: 'No todo items yet.', errorMessage: 'Could not load Todo items.', ariaLabel: 'Todo work queue',
	getExtraParams: () => ({ mode: priorityMode }), onRowClick: openEdit,
	columns: [
		{ key: 'name', label: 'Task', sortKey: 'name', className: 'admin-todo-name' },
		{ key: 'priority', label: 'Priority', sortKey: 'priority', className: 'admin-todo-number', render: (item) => todoDial(item.priority) }
	]
};
let priorityMode = 'gated';
let items = [];
let originalName = null;
let dependencies = [];

function todoDial(value, label = 'Priority') {
	const score = Math.max(0, Math.min(100, Number(value) || 0));
	const hue = score <= 20 ? 0 : score <= 50 ? ((score - 20) / 30) * 30 : 30 + ((score - 50) / 50) * 90;
	const dial = document.createElement('span');
	dial.className = 'admin-todo-dial';
	dial.style.setProperty('--todo-dial-color', `hsl(${hue} 70% 50%)`);
	dial.style.setProperty('--todo-dial-percent', `${score}%`);
	dial.textContent = String(value ?? 0);
	dial.setAttribute('aria-label', `${label} ${value ?? 0}`);
	return dial;
}
function allowedDependency(name, candidate) {
	if (!candidate || candidate === name) return false;
	const map = new Map(items.map((item) => [item.name, Array.isArray(item.dependsOn) ? item.dependsOn : []]));
	map.set(name, dependencies);
	function reaches(from, target, seen = new Set()) {
		if (from === target) return true;
		if (!from || seen.has(from)) return false;
		seen.add(from);
		return (map.get(from) || []).some((next) => reaches(next, target, seen));
	}
	return !reaches(candidate, name);
}
function renderDependencies() {
	dependencyList.replaceChildren();
	for (const dependency of dependencies) {
		const item = document.createElement('li');
		item.className = 'admin-todo-dependency';
		const name = document.createElement('span'); name.textContent = dependency;
		const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'admin-button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove dependency ${dependency}`);
		remove.addEventListener('click', () => { dependencies = dependencies.filter((entry) => entry !== dependency); renderDependencies(); updateDependencyOptions(); });
		item.append(name, remove); dependencyList.append(item);
	}
	form.elements.dependsOn.value = JSON.stringify(dependencies);
}
function updateDependencyOptions() {
	const name = form.elements.name.value.trim();
	const options = items.map((item) => item.name).filter((candidate) => !dependencies.includes(candidate) && allowedDependency(name, candidate)).sort((a, b) => a.localeCompare(b));
	dependencySelect.replaceChildren();
	const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = options.length ? 'Select a task…' : 'No available tasks'; placeholder.disabled = true; placeholder.selected = true; dependencySelect.append(placeholder);
	for (const optionName of options) { const option = document.createElement('option'); option.value = optionName; option.textContent = optionName; dependencySelect.append(option); }
	dependencySelect.disabled = options.length === 0;
}
async function loadItems() {
	const response = await fetch(`/api/todo?mode=${encodeURIComponent(priorityMode)}&limit=100`, { credentials: 'same-origin', cache: 'no-store' });
	if (!response.ok) throw new Error('Could not load Todo items.');
	const data = await response.json(); items = Array.isArray(data.items) ? data.items : [];
	writable = data.writable !== false;
	document.querySelector('[data-todo-add]').hidden = !writable;
	formula.textContent = data.formula || '';
}
async function refresh() {
	try { await loadItems(); } catch { items = []; }
	await loadAdminDataTable(table, tableConfig);
}
function openEditor(item = null) {
	if (!writable) {
		if (!item) return;
		title.textContent = item.name || 'Todo item';
		document.querySelector('[data-todo-readonly-description]').textContent = item.description || 'No description provided.';
		for (const [field, value, label] of [['cost', item.time, 'Cost'], ['impact', item.impact, 'Impact']]) {
			const container = document.querySelector(`[data-todo-readonly-${field}]`);
			container.replaceChildren(todoDial(value, label));
		}
		form.hidden = true; readonlyDetails.hidden = false; dialog.showModal(); return;
	}
	readonlyDetails.hidden = true; form.hidden = false;
	originalName = item?.name || null;
	dependencies = Array.isArray(item?.dependsOn) ? [...item.dependsOn] : [];
	title.textContent = item ? 'Todo item' : 'Add todo item';
	form.elements.name.value = item?.name || '';
	form.elements.description.value = item?.description || '';
	form.elements.time.value = String(item?.time ?? 50);
	form.elements.impact.value = String(item?.impact ?? 50);
	form.elements.starred.checked = Boolean(item?.starred);
	form.elements.name.readOnly = false;
	form.querySelector('[data-todo-save]').textContent = item ? 'Save changes' : 'Add task';
	document.querySelector('[data-todo-delete]').hidden = !item;
	document.querySelector('[data-todo-cost-value]').value = form.elements.time.value;
	document.querySelector('[data-todo-impact-value]').value = form.elements.impact.value;
	errorMessage.hidden = true; errorMessage.textContent = '';
	renderDependencies(); updateDependencyOptions(); dialog.showModal();
}
function openEdit(item) { openEditor(item); }
document.querySelector('[data-todo-add]').addEventListener('click', () => openEditor());
document.querySelector('[data-todo-close]').addEventListener('click', () => dialog.close());
document.querySelector('[data-todo-cancel]').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
document.querySelectorAll('[data-todo-mode]').forEach((button) => button.addEventListener('click', async () => {
	priorityMode = button.dataset.todoMode;
	document.querySelectorAll('[data-todo-mode]').forEach((control) => control.setAttribute('aria-pressed', String(control === button)));
	await refresh();
}));
form.elements.name.addEventListener('input', updateDependencyOptions);
form.elements.time.addEventListener('input', () => { document.querySelector('[data-todo-cost-value]').value = form.elements.time.value; });
form.elements.impact.addEventListener('input', () => { document.querySelector('[data-todo-impact-value]').value = form.elements.impact.value; });
document.querySelector('[data-todo-dependency-add]').addEventListener('click', () => {
	const selected = dependencySelect.value;
	if (!allowedDependency(form.elements.name.value.trim(), selected)) return;
	dependencies.push(selected); renderDependencies(); updateDependencyOptions();
});
form.addEventListener('submit', async (event) => {
	event.preventDefault();
	const submit = form.querySelector('[data-todo-save]'); submit.disabled = true;
	errorMessage.hidden = true;
	const payload = {
		name: form.elements.name.value, description: form.elements.description.value,
		time: Number(form.elements.time.value), impact: Number(form.elements.impact.value),
		dependsOn: dependencies, starred: form.elements.starred.checked
	};
	if (originalName) payload.originalName = originalName;
	try {
		const response = await fetch('/api/todo', { method: originalName ? 'PUT' : 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
		const result = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(result.error || 'Failed to save Todo item.');
		dialog.close(); await refresh();
	} catch (error) { errorMessage.textContent = error.message || 'Failed to save Todo item.'; errorMessage.hidden = false; }
	finally { submit.disabled = false; }
});
document.querySelector('[data-todo-delete]').addEventListener('click', async (event) => {
	const button = event.currentTarget;
	if (!button.dataset.confirm) { button.dataset.confirm = 'true'; button.textContent = 'Confirm delete'; return; }
	button.disabled = true; errorMessage.hidden = true;
	try {
		const response = await fetch('/api/todo', { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: originalName }) });
		const result = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(result.error || 'Failed to delete Todo item.');
		dialog.close(); await refresh();
	} catch (error) { errorMessage.textContent = error.message || 'Failed to delete Todo item.'; errorMessage.hidden = false; }
	finally { button.disabled = false; button.dataset.confirm = ''; button.textContent = 'Delete'; }
});

refresh();
