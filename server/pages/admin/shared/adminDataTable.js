const tableStates = new WeakMap();

function makeStatus(message, kind = '') {
	const status = document.createElement('p');
	status.className = `admin-status${kind ? ` admin-status--${kind}` : ''}`;
	status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
	status.textContent = message;
	return status;
}

function makeCell(value) {
	const cell = document.createElement('td');
	if (value instanceof Node) cell.append(value);
	else cell.textContent = value == null || value === '' ? '—' : String(value);
	return cell;
}

function renderTable(container, data, config, state) {
	data ||= {};
	const items = Array.isArray(data[config.itemsKey]) ? data[config.itemsKey] : [];
	const totalValue = Number(data.total);
	const total = Number.isFinite(totalValue) && totalValue >= 0 ? totalValue : items.length;
	container.replaceChildren();
	container.setAttribute('aria-busy', 'false');
	if (!items.length) {
		container.append(makeStatus(config.emptyMessage || 'No records.'));
		return;
	}

	const wrapper = document.createElement('div');
	wrapper.className = 'admin-table-wrap';
	const table = document.createElement('table');
	table.className = 'admin-table';
	if (config.ariaLabel) table.setAttribute('aria-label', config.ariaLabel);
	const head = table.createTHead().insertRow();
	for (const column of config.columns || []) {
		const th = document.createElement('th');
		th.scope = 'col';
		if (column.className) th.className = column.className;
		if (column.sortKey) {
			const active = state.sortBy === column.sortKey;
			th.setAttribute('aria-sort', active ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
			const sort = document.createElement('button');
			sort.type = 'button';
			sort.className = 'admin-table-sort';
			sort.textContent = `${column.label}${active ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : ''}`;
			sort.addEventListener('click', () => {
				state.sortDir = active && state.sortDir === 'desc' ? 'asc' : 'desc';
				state.sortBy = column.sortKey;
				state.offset = 0;
				void loadAdminDataTable(container, config);
			});
			th.append(sort);
		} else {
			th.textContent = column.label;
		}
		head.append(th);
	}

	const body = table.createTBody();
	for (const item of items) {
		const row = body.insertRow();
		if (config.onRowClick) {
			row.tabIndex = 0;
			row.classList.add('admin-table__interactive-row');
			row.setAttribute('aria-label', config.getRowLabel?.(item) || `Open ${config.rowLabel || 'record'}`);
			row.addEventListener('click', (event) => {
				if (event.target instanceof Element && event.target.closest('a, button, input, select, textarea')) return;
				config.onRowClick(item);
			});
			row.addEventListener('keydown', (event) => {
				if (event.target !== row || (event.key !== 'Enter' && event.key !== ' ')) return;
				event.preventDefault();
				config.onRowClick(item);
			});
		}
		for (const column of config.columns || []) {
			const value = typeof column.render === 'function' ? column.render(item) : item[column.key];
			const cell = makeCell(value);
			if (column.className) cell.className = column.className;
			row.append(cell);
		}
	}
	wrapper.append(table);
	container.append(wrapper);

	const pageSize = Math.max(1, Number(config.pageSize) || 20);
	const hasMore = config.usePageParam ? data.hasMore === true : state.offset + items.length < total;
	if (total > pageSize || state.offset > 0 || hasMore) {
		const start = total ? state.offset + 1 : 0;
		const end = Math.min(state.offset + items.length, total);
		const pager = document.createElement('div');
		pager.className = 'admin-table-pager';
		const summary = document.createElement('span');
		summary.textContent = `${start}–${end} of ${total}`;
		const actions = document.createElement('div');
		actions.className = 'admin-actions';
		const previous = document.createElement('button');
		previous.type = 'button';
		previous.className = 'admin-button';
		previous.textContent = 'Previous';
		previous.disabled = state.offset <= 0;
		previous.addEventListener('click', () => {
			state.offset = Math.max(0, state.offset - pageSize);
			void loadAdminDataTable(container, config);
		});
		const next = document.createElement('button');
		next.type = 'button';
		next.className = 'admin-button';
		next.textContent = 'Next';
		next.disabled = !hasMore;
		next.addEventListener('click', () => {
			state.offset += pageSize;
			void loadAdminDataTable(container, config);
		});
		actions.append(previous, next);
		pager.append(summary, actions);
		container.append(pager);
	}
}

/** Load a server-paged, sortable table into a page-owned container. */
export async function loadAdminDataTable(container, config) {
	let state = tableStates.get(container);
	if (!state) {
		state = { offset: 0, sortBy: config.defaultSortBy || null, sortDir: config.defaultSortDir || 'desc', requestId: 0, controller: null };
		tableStates.set(container, state);
	}
	state.controller?.abort();
	const controller = new AbortController();
	state.controller = controller;
	const requestId = ++state.requestId;
	container.setAttribute('aria-busy', 'true');
	container.replaceChildren(makeStatus(config.loadingMessage || 'Loading…', 'loading'));

	const pageSize = Math.max(1, Number(config.pageSize) || 20);
	const params = new URLSearchParams({ limit: String(pageSize) });
	if (config.usePageParam) params.set('page', String(Math.floor(state.offset / pageSize) + 1));
	else params.set('offset', String(state.offset));
	if (state.sortBy) {
		params.set('sort_by', state.sortBy);
		params.set('sort_dir', state.sortDir);
	}
	for (const [key, value] of Object.entries(config.getExtraParams?.() || {})) {
		if (value != null && value !== '') params.set(key, String(value));
	}
	try {
		const response = await fetch(`${config.fetchUrl}?${params}`, { credentials: 'same-origin', signal: controller.signal });
		if (!response.ok) throw new Error(`Request failed (${response.status})`);
		const data = await response.json();
		if (requestId === state.requestId) renderTable(container, data, config, state);
	} catch (error) {
		if (error.name === 'AbortError' || requestId !== state.requestId) return;
		container.setAttribute('aria-busy', 'false');
		container.replaceChildren(makeStatus(config.errorMessage || 'Could not load records.', 'error'));
	}
	return {
		refresh: () => loadAdminDataTable(container, config),
		destroy: () => destroyAdminDataTable(container)
	};
}

export function destroyAdminDataTable(container) {
	const state = tableStates.get(container);
	state?.controller?.abort();
	tableStates.delete(container);
	container.removeAttribute('aria-busy');
}
