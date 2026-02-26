import { fetchJsonWithStatusDeduped } from '../../shared/api.js';
import { starIcon } from '../../icons/svg-strings.js';
import { renderEmptyLoading } from '../../shared/emptyState.js';
import { buildTodoRowElement, buildTodoGhostRow, applyDialStyles } from '../../shared/todoCard.js';

const html = String.raw;

function normalizeTodoMode(mode) {
	if (mode === 'post') return 'ratio';
	if (mode === 'pre') return 'gated';
	if (mode === 'ratio' || mode === 'impact' || mode === 'cost') return mode;
	return 'gated';
}

class AppRouteTodo extends HTMLElement {
	connectedCallback() {
		this._priorityMode = 'gated';
		this._writable = true;
		this._itemsCache = [];

		this.innerHTML = html`
			<div class="todo-header">
				<h3>Todo</h3>
				<div class="todo-mode-toggle" data-todo-mode-toggle role="group" aria-label="Priority mode">
					<button type="button" class="todo-mode-button" data-todo-mode="gated" aria-pressed="true">Gated</button>
					<button type="button" class="todo-mode-button" data-todo-mode="ratio" aria-pressed="false">Ratio</button>
					<button type="button" class="todo-mode-button" data-todo-mode="impact" aria-pressed="false">Impact</button>
					<button type="button" class="todo-mode-button" data-todo-mode="cost" aria-pressed="false">Cost</button>
				</div>
			</div>
			<div class="todo-layout">
				<div class="todo-list" data-todo-list>
					${renderEmptyLoading({})}
				</div>
			</div>
		`;

		this._list = this.querySelector('[data-todo-list]');
		this._toggle = this.querySelector('[data-todo-mode-toggle]');
		this._modeButtons = this._toggle ? Array.from(this._toggle.querySelectorAll('[data-todo-mode]')) : [];

		this._boundUpdated = () => this.loadTodo({ force: true });
		document.addEventListener('todo-updated', this._boundUpdated);

		this.setupModeToggle();
		this.setupListClicks();
		this.loadTodo();
	}

	disconnectedCallback() {
		document.removeEventListener('todo-updated', this._boundUpdated);
	}

	setupModeToggle() {
		if (!this._modeButtons.length) return;
		this.setPriorityMode(this._priorityMode);
		this._modeButtons.forEach((button) => {
			button.addEventListener('click', () => {
				const nextMode = normalizeTodoMode(button.dataset.todoMode);
				if (nextMode === this._priorityMode) return;
				this.setPriorityMode(nextMode);
				this.loadTodo({ force: true });
			});
		});
	}

	setPriorityMode(mode) {
		this._priorityMode = normalizeTodoMode(mode);
		this._modeButtons.forEach((button) => {
			const isActive = button.dataset.todoMode === this._priorityMode;
			button.classList.toggle('is-active', isActive);
			button.setAttribute('aria-pressed', String(isActive));
		});
	}

	setupListClicks() {
		if (!this._list) return;
		this._list.addEventListener('click', (e) => {
			const target = e.target;
			if (!(target instanceof HTMLElement)) return;

			if (target.dataset.todoAdd !== undefined) {
				this.openTodoModal({ mode: 'add' });
				return;
			}

			const row = target.closest('.todo-card');
			if (!row || row.querySelector('.todo-ghost')) return;

			const item = {
				name: row.dataset.itemName,
				description: row.dataset.itemDescription,
				time: row.dataset.itemTime,
				impact: row.dataset.itemImpact,
				dependsOn: JSON.parse(row.dataset.itemDependsOn || '[]'),
				starred: row.dataset.itemStarred === '1'
			};

			if (!this._writable) {
				this.openTodoModal({ mode: 'readonly', item });
				return;
			}

			this.openTodoModal({ mode: 'edit', item });
		});
	}

	openTodoModal({ mode, item } = {}) {
		const modal = document.querySelector('app-modal-todo');
		if (!modal) return;
		modal.open({
			mode,
			item,
			writable: this._writable,
			itemsCache: this._itemsCache,
			priorityMode: this._priorityMode
		});
	}

	renderTodoRows(items, writable) {
		if (!this._list) return;
		this._list.innerHTML = '';

		const sortedItems = [...(items || [])].sort((a, b) => {
			const aStar = Boolean(a.starred);
			const bStar = Boolean(b.starred);
			if (aStar !== bStar) return bStar ? 1 : -1;
			return (b.priority ?? 0) - (a.priority ?? 0);
		});
		if (!sortedItems.length) {
			const empty = document.createElement('div');
			empty.className = 'todo-loading';
			empty.textContent = 'No todo items yet.';
			this._list.appendChild(empty);
			return;
		}

		sortedItems.forEach((item, index) => {
			const row = buildTodoRowElement(item, { showStar: true });
			if (index === sortedItems.length - 1) row.classList.add('todo-card-last');
			this._list.appendChild(row);
		});

		if (writable) {
			this._list.appendChild(buildTodoGhostRow());
		}
	}

	async loadTodo({ force = false } = {}) {
		if (!this._list) return;
		try {
			const query = new URLSearchParams({ mode: this._priorityMode });
			const result = await fetchJsonWithStatusDeduped(`/api/todo?${query.toString()}`, { credentials: 'include' }, { windowMs: 2000 });
			if (!result.ok) {
				throw new Error('Failed to load todo.');
			}
			const writable = result.data?.writable !== false;
			this._writable = writable;
			this._itemsCache = Array.isArray(result.data?.items) ? result.data.items : [];
			this.renderTodoRows(this._itemsCache, writable);
		} catch (err) {
			this._list.innerHTML = '';
			const item = document.createElement('div');
			item.className = 'todo-loading';
			item.textContent = 'Error loading todo.';
			this._list.appendChild(item);
		}
	}
}

customElements.define('app-route-todo', AppRouteTodo);

