/**
 * Standard paged table toolbar: "Showing X–Y of Z" plus Previous/Next.
 * Uses limit + offset (0-based). Reuse admin toolbar classes for consistent look.
 *
 * @param {Object} opts
 * @param {number} opts.total - Total number of items
 * @param {number} opts.limit - Page size
 * @param {number} opts.offset - Current offset (0-based)
 * @param {() => void} opts.onPrev - Called when Previous is clicked
 * @param {() => void} opts.onNext - Called when Next is clicked
 * @param {string} [opts.ariaLabel='Pagination'] - aria-label for nav
 * @returns {HTMLDivElement} Toolbar element to place below the table
 */
export function createPagedTableToolbar({ total, limit, offset, onPrev, onNext, ariaLabel = 'Pagination' }) {
	const start = total === 0 ? 0 : offset + 1;
	const end = Math.min(offset + limit, total);
	const noPrev = offset <= 0;
	const noNext = total === 0 || offset + limit >= total;

	const toolbar = document.createElement('div');
	toolbar.className = 'paged-table-toolbar';

	const summary = document.createElement('span');
	summary.className = 'paged-table-summary';
	summary.textContent = `Showing ${start}–${end} of ${total}`;
	toolbar.appendChild(summary);

	const nav = document.createElement('div');
	nav.className = 'paged-table-nav';
	nav.setAttribute('aria-label', ariaLabel);

	const prevBtn = document.createElement('button');
	prevBtn.type = 'button';
	prevBtn.className = 'paged-table-prev btn-secondary';
	prevBtn.textContent = 'Previous';
	prevBtn.disabled = noPrev;
	prevBtn.addEventListener('click', () => { if (!noPrev) onPrev(); });

	const nextBtn = document.createElement('button');
	nextBtn.type = 'button';
	nextBtn.className = 'paged-table-next btn-secondary';
	nextBtn.textContent = 'Next';
	nextBtn.disabled = noNext;
	nextBtn.addEventListener('click', () => { if (!noNext) onNext(); });

	nav.appendChild(prevBtn);
	nav.appendChild(nextBtn);
	toolbar.appendChild(nav);

	return toolbar;
}
