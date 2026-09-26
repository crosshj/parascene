import { escapeHtml } from '../../utils/dom.js';

const ICONS = {
	home: '<path d="M3 9 12 2l9 7v11a2 2 0 0 1-2 2h-4V12H9v10H5a2 2 0 0 1-2-2Z"/>',
	trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 8H5a2 2 0 0 1-2-2V5h2M17 8h2a2 2 0 0 0 2-2V5h-2"/>',
	picture: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m21 17-5-5L5 19"/>',
	files: '<path d="M4 4.5h5l2 2h9v13H4Z"/><path d="M4 9h16"/>',
	notes: '<path d="M4 4.75A2.25 2.25 0 0 1 6.25 2.5h11.5A2.25 2.25 0 0 1 20 4.75v14.5a2.25 2.25 0 0 1-2.25 2.25H6.25A2.25 2.25 0 0 1 4 19.25ZM8.25 7h7.5M8.25 11.5h7.5M8.25 16h5"/>',
	comments: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
	globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2Z"/>',
	book: '<path d="M12 6.04A8.97 8.97 0 0 0 6 3.75c-1.05 0-2.06.18-3 .51v14.25A8.99 8.99 0 0 1 6 18c2.3 0 4.41.87 6 2.29m0-14.25a8.97 8.97 0 0 1 6-2.29c1.05 0 2.06.18 3 .51v14.25A8.99 8.99 0 0 0 18 18a8.97 8.97 0 0 0-6 2.29m0-14.25v14.25"/>',
	megaphone: '<path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm-5 8a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14M8 6v8"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
	bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>',
	credits: '<circle cx="12" cy="12" r="9"/><path d="M9.3 16.6V7.75h3.34c2.28 0 3.42.86 3.42 2.57 0 1.8-1.1 2.7-3.32 2.7h-2.27v3.58Zm1.17-4.63h2.29c1.39 0 2.09-.54 2.09-1.61 0-1.04-.7-1.56-2.11-1.56h-2.27Z"/>',
	user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
	logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
	settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3h4v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21v4h-.09A1.65 1.65 0 0 0 19.4 15Z"/>',
	info: '<circle cx="12" cy="12" r="10"/><path d="M12 11v5M12 8h.01"/>',
	chart: '<path d="M5 19V11M12 19V5M19 19V8"/>',
	help: '<circle cx="12" cy="12" r="10"/><path d="M9.6 9a2.5 2.5 0 1 1 4.7 1.2c-.7 1.1-2.3 1.4-2.3 3M12 17h.01"/>',
	close: '<path d="m18 6-12 12M6 6l12 12"/>'
};

const STROKE_WIDTHS = {
	home: 2,
	trophy: 2,
	picture: 2,
	notes: 1.8,
	comments: 1.8,
	globe: 1.5,
	book: 1.5,
	megaphone: 2,
	plus: 2,
	bell: 2,
	credits: 2,
	user: 2,
	logout: 2
};

export function iconMarkup(name, className = '') {
	const paths = ICONS[name];
	if (!paths) return '';
	const classAttribute = className ? ` class="${escapeHtml(className)}"` : '';
	return `<svg${classAttribute} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${STROKE_WIDTHS[name] || 1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
