/** Help is standalone HTML served by the VPS Help routes, outside the SPA shell. */
export function getHelpHref(path) {
	if (typeof path !== 'string' || !path.startsWith('/help')) return path;
	return path;
}

export function isHelpHref(href) {
	return typeof href === 'string' && /^\/help(?:\/|$)/.test(href);
}
