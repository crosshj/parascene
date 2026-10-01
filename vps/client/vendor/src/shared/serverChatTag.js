/**
 * Build a chat channel tag from server display name only (no numeric id suffix).
 * Must match chat API tag rules: 2–32 chars, /^[a-z0-9][a-z0-9_-]{1,31}$/
 *
 * If two servers share the same display name, they map to the same channel slug (shared thread).
 *
 * @param {string} [name]
 * @returns {string | null}
 */
export function serverChannelTagFromServerName(name) {
	let raw = String(name || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^-+|-+$/g, '');

	if (!raw) raw = 'server';

	raw = raw.slice(0, 32).replace(/-+$/g, '');
	if (!raw) raw = 'server';

	if (raw.length < 2) raw = 'server';

	if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(raw)) return 'server';
	return raw;
}
