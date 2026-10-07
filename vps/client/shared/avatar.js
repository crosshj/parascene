const AVATAR_COLORS = [
	'#7c3aed',
	'#05c76f',
	'#3b82f6',
	'#f59e0b',
	'#ef4444',
	'#ec4899',
	'#14b8a6',
	'#8b5cf6',
	'#f97316',
	'#06b6d4',
	'#84cc16',
	'#a855f7',
	'#10b981',
	'#6366f1',
	'#f43f5e',
	'#0ea5e9'
];

export function normalizeAvatarUrl(value) {
	const url = typeof value === 'string' ? value.trim() : '';
	if (!url || /^(?:null|undefined|false)$/i.test(url) || /^\/(?:null|undefined)$/i.test(url)) return '';
	return url;
}

function escapeAvatarHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Face markup for an avatar shell. A URL keeps the initial in the DOM but CSS
 * hides it until the image fails. No URL renders the initial immediately.
 * @param {string} url
 * @param {string} initial
 * @param {{ imgClass?: string, fallbackClass?: string, fallbackStyle?: string }} [options]
 */
export function avatarPendingFaceHtml(url, initial, options = {}) {
	const letter = escapeAvatarHtml(String(initial || '?').trim().charAt(0).toUpperCase() || '?');
	const fallbackClass = options.fallbackClass || 'avatar-fallback-label';
	const style = options.fallbackStyle ? ` style="${escapeAvatarHtml(options.fallbackStyle)}"` : '';
	const label = `<span class="${escapeAvatarHtml(fallbackClass)}"${style} aria-hidden="true">${letter}</span>`;
	const safeUrl = normalizeAvatarUrl(url);
	if (!safeUrl) return label;
	const imgClass = options.imgClass ? ` class="${escapeAvatarHtml(options.imgClass)}"` : '';
	return `${label}<img${imgClass} data-avatar-src="${escapeAvatarHtml(safeUrl)}" alt="">`;
}

function hashString(input) {
	const str = String(input ?? '');
	let hash = 5381;
	for (let i = 0; i < str.length; i += 1) {
		hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
	}
	return hash >>> 0;
}
export function getAvatarColor(seed) {
	const str = String(seed ?? '').trim().toLowerCase();
	if (!str) return AVATAR_COLORS[0];
	const idx = hashString(str) % AVATAR_COLORS.length;
	return AVATAR_COLORS[idx];
}
