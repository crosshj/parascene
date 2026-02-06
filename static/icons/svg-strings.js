// SVG strings for icons (static/icons). Use across the site (DRY).
// Each icon is a function (className?) => string so callers pass their class directly.

export function homeIcon(className = '') {
	const classAttr = className ? ` class="${className}"` : '';
	return `<svg${classAttr} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="home-house" d="M 3 9 L 12 2 L 21 9 L 21 20 C 21 21.105 20.105 22 19 22 L 15 22 L 15 12 L 9 12 L 9 22 L 5 22 C 3.895 22 3 21.105 3 20 Z"></path></svg>`;
}

export function helpIcon(className = '') {
	const classAttr = className ? ` class="${className}"` : '';
	return `<svg${classAttr} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
}
