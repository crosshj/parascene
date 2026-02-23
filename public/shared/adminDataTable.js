/**
 * Single admin table implementation: paging + sortable columns.
 * Renders into container; keeps state on container for reloads.
 *
 * Config:
 *   fetchUrl: string
 *   responseItemsKey: 'jobs' | 'sends' | 'items' | 'anonCids' (key in response for rows array)
 *   columns: Array<{ key: string, label: string, className?: string, sortKey?: string, render?: (row) => string }>
 *   defaultSortBy?: string (sortKey value)
 *   defaultSortDir?: 'asc' | 'desc'
 *   pageSize: number
 *   emptyMessage: string
 *   ariaLabelPagination?: string
 *   getExtraParams?: () => Record<string, string>
 *   onRowClick?: (row) => void
 *   tableClassName?: string (default 'admin-table')
 *   usePageParam?: boolean — if true, send page (1-based) instead of offset (transitions API)
 */

import { createPagedTableToolbar } from './pagedTable.js';

function escapeHtml(text) {
	const s = String(text ?? '');
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

const STATE_KEY = '_adminDataTableState';

function getState(container) {
	if (!container[STATE_KEY]) {
		container[STATE_KEY] = { offset: 0, sortBy: null, sortDir: 'desc' };
	}
	return container[STATE_KEY];
}

/**
 * @param {HTMLElement} container
 * @param {Object} config
 * @param {string} config.fetchUrl
 * @param {string} config.responseItemsKey
 * @param {Array<{ key: string, label: string, className?: string, sortKey?: string, render?: (row) => string }>} config.columns
 * @param {string} [config.defaultSortBy]
 * @param {'asc'|'desc'} [config.defaultSortDir='desc']
 * @param {number} config.pageSize
 * @param {string} config.emptyMessage
 * @param {string} [config.ariaLabelPagination='Pagination']
 * @param {() => Record<string,string>} [config.getExtraParams]
 * @param {(row: any) => void} [config.onRowClick]
 * @param {string} [config.tableClassName='admin-table']
 * @param {boolean} [config.usePageParam] - send page instead of offset (e.g. transitions)
 * @returns {Promise<void>}
 */
export async function loadAdminDataTable(container, config) {
	const {
		fetchUrl,
		responseItemsKey,
		columns,
		defaultSortBy,
		defaultSortDir = 'desc',
		pageSize,
		emptyMessage,
		ariaLabelPagination = 'Pagination',
		getExtraParams,
		onRowClick,
		tableClassName = 'admin-table',
		usePageParam = false
	} = config;

	const state = getState(container);
	const sortBy = state.sortBy ?? defaultSortBy ?? (columns.find((c) => c.sortKey)?.sortKey);
	const sortDir = state.sortDir ?? defaultSortDir;
	const offset = state.offset ?? 0;

	const params = new URLSearchParams();
	params.set('limit', String(pageSize));
	if (usePageParam) {
		params.set('page', String(Math.floor(offset / pageSize) + 1));
	} else {
		params.set('offset', String(offset));
	}
	if (sortBy) {
		params.set('sort_by', sortBy);
		params.set('sort_dir', sortDir);
	}
	const extra = typeof getExtraParams === 'function' ? getExtraParams() : {};
	for (const [k, v] of Object.entries(extra)) {
		if (v != null && v !== '') params.set(k, String(v));
	}

	const response = await fetch(`${fetchUrl}?${params}`, { credentials: 'include' });
	if (!response.ok) throw new Error('Failed to load data.');
	const data = await response.json();

	const items = Array.isArray(data[responseItemsKey]) ? data[responseItemsKey] : [];
	const total = Number(data.total) ?? 0;

	container.innerHTML = '';

	if (items.length === 0 && total === 0) {
		const empty = document.createElement('div');
		empty.className = 'admin-empty';
		empty.textContent = emptyMessage;
		container.appendChild(empty);
		return;
	}

	const wrapper = document.createElement('div');
	wrapper.className = 'admin-datatable-wrapper';

	const table = document.createElement('table');
	table.className = tableClassName;
	table.setAttribute('role', 'grid');

	const thead = document.createElement('thead');
	const headerRow = document.createElement('tr');
	for (const col of columns) {
		const th = document.createElement('th');
		th.scope = 'col';
		th.className = [col.className, col.sortKey ? 'admin-table-sortable' : ''].filter(Boolean).join(' ').trim() || undefined;
		if (col.sortKey) {
			th.dataset.sort = col.sortKey;
			const isActive = sortBy === col.sortKey;
			const arrow = isActive ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : '';
			th.textContent = col.label + arrow;
			th.setAttribute('aria-sort', isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
			th.addEventListener('click', () => {
				state.sortBy = col.sortKey;
				state.sortDir = sortBy === col.sortKey && sortDir === 'desc' ? 'asc' : 'desc';
				state.offset = 0;
				loadAdminDataTable(container, config);
			});
		} else {
			th.textContent = col.label;
		}
		headerRow.appendChild(th);
	}
	thead.appendChild(headerRow);
	table.appendChild(thead);

	const tbody = document.createElement('tbody');
	for (const row of items) {
		const tr = document.createElement('tr');
		if (onRowClick) {
			tr.tabIndex = 0;
			tr.setAttribute('role', 'button');
			tr.addEventListener('click', (e) => {
				if (e.target.closest('a')) return;
				onRowClick(row);
			});
			tr.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onRowClick(row);
				}
			});
		}
		for (const col of columns) {
			const td = document.createElement('td');
			if (col.className) td.className = col.className;
			const content = typeof col.render === 'function' ? col.render(row) : escapeHtml(row[col.key] ?? '—');
			td.innerHTML = content;
			tr.appendChild(td);
		}
		tbody.appendChild(tr);
	}
	table.appendChild(tbody);
	wrapper.appendChild(table);

	if (total > 0) {
		const hasMore = usePageParam ? (data.hasMore === true) : offset + pageSize < total;
		const toolbar = createPagedTableToolbar({
			total,
			limit: pageSize,
			offset,
			onPrev: () => {
				state.offset = Math.max(0, offset - pageSize);
				loadAdminDataTable(container, config);
			},
			onNext: () => {
				state.offset = offset + pageSize;
				loadAdminDataTable(container, config);
			},
			ariaLabel: ariaLabelPagination
		});
		wrapper.appendChild(toolbar);
	}

	container.appendChild(wrapper);
}
