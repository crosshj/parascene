// SVG strings for icons (static/icons). Use across the site (DRY).
// Each icon is (className?) => string. Wrap full SVG with withAttributes to add optional class.

const html = String.raw;

/** Returns (className?) => string that injects class into the <svg> tag when provided. */
function withAttributes(svgString) {
	return (className = '') => {
		if (!className) return svgString;
		return svgString.replace('<svg', `<svg class="${className}" `);
	}
}

// ICONS

export const homeIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path class="home-house" d="M 3 9 L 12 2 L 21 9 L 21 20 C 21 21.105 20.105 22 19 22 L 15 22 L 15 12 L 9 12 L 9 22 L 5 22 C 3.895 22 3 21.105 3 20 Z">
		</path>
	</svg>
`);

export const helpIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<circle cx="12" cy="12" r="10"></circle>
		<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
		<line x1="12" y1="17" x2="12.01" y2="17"></line>
	</svg>
`);

export const xIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<path d="M21.742 21.75l-7.563-11.179 7.056-8.321h-2.456l-5.691 6.714-4.54-6.714H2.359l7.29 10.776L2.25 21.75h2.456l6.035-7.118 4.818 7.118h6.191-.008zM7.739 3.818L18.81 20.182h-2.447L5.29 3.818h2.447z"></path>
	</svg>
`);

export const facebookIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H7v3h3v7h3v-7h3l1-3h-4v-2c0-.6.4-1 1-1z"></path>
	</svg>
`);

export const redditIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<circle cx="12" cy="13" r="5"></circle>
		<circle cx="10.2" cy="13" r="0.8" fill="currentColor" stroke="none"></circle>
		<circle cx="13.8" cy="13" r="0.8" fill="currentColor" stroke="none"></circle>
		<path d="M10.3 15.2c.7.7 1.5 1.1 1.7 1.1s1-.4 1.7-1.1"></path>
		<path d="M13.9 8.6l2.2-1.1"></path>
		<circle cx="18.1" cy="7.2" r="1.2"></circle>
	</svg>
`);

export const linkedinIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path d="M6.5 9.5H3.8V21h2.7V9.5zM5.2 3C4.2 3 3.4 3.8 3.4 4.8s.8 1.8 1.8 1.8S7 5.8 7 4.8 6.2 3 5.2 3zM20.6 21h-2.7v-5.9c0-1.4 0-3.2-2-3.2s-2.3 1.5-2.3 3.1V21H10.9V9.5h2.6v1.6h.04c.36-.7 1.24-1.5 2.56-1.5 2.74 0 3.25 1.8 3.25 4.2V21z"></path>
	</svg>
`);

export const smsIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>
	</svg>
`);

export const emailIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M4 6h16v12H4z"></path>
		<path d="M4 7l8 6 8-6"></path>
	</svg>
`);

export const shareIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<circle cx="18" cy="5" r="2"></circle>
		<circle cx="6" cy="12" r="2"></circle>
		<circle cx="18" cy="19" r="2"></circle>
		<path d="M8 12l8-6"></path>
		<path d="M8 12l8 6"></path>
	</svg>
`);

export const linkIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1"></path>
		<path d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1"></path>
	</svg>
`);
