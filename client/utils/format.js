export function formatFileSize(value) {
	const bytes = Number(value);
	if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let size = bytes / 1024;
	let unit = units[0];
	for (let i = 1; i < units.length && size >= 1024; i += 1) { size /= 1024; unit = units[i]; }
	return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${unit}`;
}

export function formatDate(value) {
	if (!value) return 'Unknown date';
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

// Match the active WWW SPA: fractional credits are displayed as a plus
// because the sidebar is showing an approximate whole-credit count. Do not
// add locale separators; the compact footer value must not change width.
export function formatCredits(value) {
	const count = Number(value);
	if (!Number.isFinite(count)) return '0';
	const normalized = Math.max(0, Math.round(count * 10) / 10);
	const whole = Math.floor(normalized);
	return normalized > whole ? `${whole}+` : String(whole);
}
