import { parseSidebarPath } from '../utils/sidebarRoutes.js';

function normalizedUrl(value) {
	const url = new URL(String(value || '/'), location.origin);
	return `${url.pathname.replace(/\/+$/, '') || '/'}${url.search}${url.hash}`;
}

function fallbackChrome(pathname) {
	const parsed = parseSidebarPath(pathname);
	if (parsed.kind === 'dm') return { title: parsed.userName || 'Direct message', icon: 'user' };
	if (parsed.kind === 'channel') return { title: parsed.slug || 'Channel', icon: 'comments' };
	return { title: 'Coming soon', icon: 'home' };
}

function matchPattern(pattern, pathname) {
	if (pattern === '*') return { pathname };
	const patternParts = pattern.split('/').filter(Boolean);
	const pathParts = pathname.split('/').filter(Boolean);
	if (patternParts.length !== pathParts.length) return null;
	const params = {};
	for (let index = 0; index < patternParts.length; index++) {
		const expected = patternParts[index];
		const actual = pathParts[index];
		if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
		else if (expected !== actual) return null;
	}
	return params;
}

export function createAppRoutes({ definitions = [] } = {}) {
	if (!definitions.length) throw new Error('The application must declare its routes');

	function match(value) {
		const url = new URL(value, location.origin);
		const pathname = url.pathname.replace(/\/+$/, '') || '/';
		for (const definition of definitions) {
			const params = matchPattern(definition.path, pathname);
			if (!params) continue;
			if (definition.path === '/creations/:creationId' || definition.path === '/feed/doom/:creationId') {
				const creationId = Number(params.creationId);
				if (!Number.isFinite(creationId) || creationId <= 0) continue;
				params.creationId = creationId;
			}
			return {
				...definition,
				presentation: definition.presentation || 'page',
				params,
			};
		}
		throw new Error(`No route declaration matches ${pathname}`);
	}

	function page(value) {
		const url = new URL(value, location.origin);
		const route = match(url);
		if (route.presentation === 'overlay') return page(route.defaultBackground);
		const params = route.params || {};
		const titleMode = route.titleMode;
		const title = titleMode === 'channel' ? `#${params.slug}` :
			titleMode === 'feedback' ? '#feedback' :
			titleMode === 'dm' ? `@${params.slug}` :
			titleMode === 'notes' ? 'My Notes' : null;
		const defaults = fallbackChrome(url.pathname);
		const resolvedTitle = title || route.title || 'Coming soon';
		return {
			key: `route:${route.path}:${Object.values(params).join(':')}`,
			view: route.view,
			props: { title: resolvedTitle, viewName: route.viewName || route.title || resolvedTitle, ...params },
			chrome: { title: resolvedTitle, icon: route.icon || defaults.icon, composer: route.composer || 'message' },
		};
	}

	function resolve({ url, backgroundUrl, seed = null } = {}) {
		const canonicalUrl = normalizedUrl(url);
		const route = match(canonicalUrl);
		if (route.presentation !== 'overlay') {
			const outlet = page(canonicalUrl);
			return {
				url: canonicalUrl,
				backgroundUrl: canonicalUrl,
				shell: 'app',
				outlet,
				overlay: null,
			};
		}

		const candidateBackground = normalizedUrl(backgroundUrl || route.defaultBackground);
		const resolvedBackground = match(candidateBackground).presentation === 'overlay'
			? route.defaultBackground
			: candidateBackground;
		const outlet = page(resolvedBackground);
		return {
			url: canonicalUrl,
			backgroundUrl: resolvedBackground,
			shell: 'app',
			outlet,
			overlay: {
				key: `overlay:${route.path}:${Object.values(route.params).join(':')}`,
				view: route.view,
				props: {
					...Object.fromEntries(Object.entries(route.params).filter(([key]) => key !== 'id')),
					...(route.params.creationId ? { creationId: route.params.creationId } : {}),
					viewName: route.viewName || route.title || 'Details',
					seed,
				},
				title: route.title || (route.params.creationId ? `Creation #${route.params.creationId}` : 'Details'),
			},
		};
	}

	return { match, resolve };
}
