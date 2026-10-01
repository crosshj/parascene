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
			if (definition.name === 'creation-detail') {
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
		if (route.name === 'home') {
			return { key: 'home', view: route.view, props: {}, chrome: { title: 'Feed', icon: 'home', showComposer: true } };
		}
		if (route.name === 'creations') {
			return { key: 'creations', view: route.view, props: {}, chrome: { title: 'My Creations', icon: 'picture', showComposer: true } };
		}
		if (route.name === 'files') {
			return { key: 'files', view: route.view, props: {}, chrome: { title: 'My Files', icon: 'files', showComposer: false } };
		}
		const chrome = fallbackChrome(url.pathname);
		return {
			key: `fallback:${url.pathname}`,
			view: route.view,
			props: { title: chrome.title },
			chrome: { ...chrome, showComposer: true },
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
				key: `creation-detail:${route.params.creationId}`,
				view: route.view,
				props: { creationId: route.params.creationId, seed },
				title: `Creation #${route.params.creationId}`,
			},
		};
	}

	return { match, resolve };
}
