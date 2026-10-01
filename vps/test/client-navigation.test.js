import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppRoutes } from '../client/app/routes.js';
import { createRouter } from '../client/core/router.js';

const views = {
	Feed: {}, Explore: {}, Challenges: {}, Comments: {}, Channel: {}, DirectMessage: {}, Library: {},
	Creations: {}, FileManager: {}, NotFound: {}, Create: {}, DoomScroll: {}, CreationDetail: {},
};

const definitions = [
	{ path: '/', view: views.Feed, title: 'Feed', icon: 'home', composer: 'none' },
	{ path: '/feed', view: views.Feed, title: 'Feed', icon: 'home', composer: 'none' },
	{ path: '/feed/doom/:creationId', view: views.DoomScroll, title: 'Doom Scroll', presentation: 'overlay', defaultBackground: '/feed', composer: 'none' },
	{ path: '/explore', view: views.Explore, title: 'Explore' },
	{ path: '/challenges', view: views.Challenges, title: 'Challenges' },
	{ path: '/challenges/organize', view: views.Challenges, title: 'Organize challenges', viewName: 'Challenges · Organize' },
	{ path: '/challenges/details/:challengeId', view: views.Challenges, title: 'Challenge details', viewName: 'Challenges · Details' },
	{ path: '/comments', view: views.Comments, title: 'Comments' },
	{ path: '/ch/:slug', view: views.Channel, titleMode: 'channel' },
	{ path: '/dm/:slug', view: views.DirectMessage, titleMode: 'dm' },
	{ path: '/notes', view: views.DirectMessage, titleMode: 'notes', slug: 'self' },
	{ path: '/library', view: views.Library, title: 'Library' },
	{ path: '/feedback', view: views.Channel, titleMode: 'feedback', title: '#feedback', slug: 'feedback' },
	{ path: '/creations', view: views.Creations, title: 'My Creations' },
	{ path: '/files', view: views.FileManager, title: 'My Files' },
	{ path: '/create', view: views.Create, presentation: 'overlay', defaultBackground: '/feed', title: 'Create', composer: 'none' },
	{ path: '/creations/:creationId', view: views.CreationDetail, presentation: 'overlay', defaultBackground: '/creations', params: { id: 'creationId' } },
	{ path: '*', view: views.NotFound },
];

function browserAt(initialPath) {
	const prior = {
		location: globalThis.location,
		history: globalThis.history,
		document: globalThis.document,
		window: globalThis.window,
	};
	const location = { origin: 'http://example.test', pathname: '/', search: '', hash: '' };
	const setLocation = (value) => {
		const url = new URL(value, location.origin);
		location.pathname = url.pathname;
		location.search = url.search;
		location.hash = url.hash;
	};
	setLocation(initialPath);
	const calls = [];
	const history = {
		state: null,
		pushState(state, _title, url) { this.state = state; calls.push(['push', url]); setLocation(url); },
		replaceState(state, _title, url) { this.state = state; calls.push(['replace', url]); setLocation(url); },
	};
	globalThis.location = location;
	globalThis.history = history;
	globalThis.document = new EventTarget();
	globalThis.window = new EventTarget();
	return {
		calls,
		history,
		restore() {
			for (const [key, value] of Object.entries(prior)) {
				if (value === undefined) delete globalThis[key];
				else globalThis[key] = value;
			}
		},
	};
}

function harness(path) {
	const browser = browserAt(path);
	const applied = [];
	const navigation = [];
	const layout = {
		async apply(composition) { applied.push(composition); },
		destroy() {},
	};
	const state = { actions: { navigationResolved(value) { navigation.push(value); } } };
	const routes = createAppRoutes({ definitions });
	const router = createRouter({ routes, state, layout });
	return { browser, applied, navigation, router };
}

test('a creation deep link resolves the default page beneath the overlay without pushing', async (t) => {
	const app = harness('/creations/42');
	t.after(() => app.browser.restore());
	await app.router.start();
	const composition = app.applied.at(-1);
	assert.equal(composition.outlet.key, 'route:/creations:');
	assert.equal(composition.overlay.key, 'overlay:/creations/:creationId:42');
	assert.equal(composition.backgroundUrl, '/creations');
	assert.deepEqual(app.browser.calls, [['replace', '/creations/42']]);
	app.router.destroy();
});

test('overlay navigation retains its original background and passes the card seed', async (t) => {
	const app = harness('/files?kind=audio');
	t.after(() => app.browser.restore());
	await app.router.start();
	const seed = { id: 7, title: 'Seeded' };
	await app.router.navigate('/creations/7', { seed });
	let composition = app.applied.at(-1);
	assert.equal(composition.backgroundUrl, '/files?kind=audio');
	assert.equal(composition.outlet.key, 'route:/files:');
	assert.equal(composition.overlay.props.seed, seed);

	await app.router.navigate('/creations/8');
	composition = app.applied.at(-1);
	assert.equal(composition.backgroundUrl, '/files?kind=audio');
	assert.equal(composition.overlay.key, 'overlay:/creations/:creationId:8');

	await app.router.dismissOverlay();
	composition = app.applied.at(-1);
	assert.equal(composition.url, '/files?kind=audio');
	assert.equal(composition.overlay, null);
	assert.deepEqual(app.browser.calls.map(([method]) => method), ['push', 'push', 'replace']);
	app.router.destroy();
});

test('all declared app routes resolve with the expected overlay and dynamic route props', () => {
	const browser = browserAt('/');
	try {
		const routes = createAppRoutes({ definitions });
		const expected = [
			'/', '/feed', '/feed/doom/42', '/explore', '/challenges', '/challenges/organize',
			'/challenges/details/demo', '/comments', '/ch/general', '/dm/example', '/notes',
			'/library', '/feedback', '/creations', '/files', '/create', '/creations/42', '/not-a-route',
		];
		for (const path of expected) assert.ok(routes.match(path), `Expected route for ${path}`);

		const challengeDetails = routes.resolve({ url: '/challenges/details/demo' });
		assert.equal(challengeDetails.outlet.props.challengeId, 'demo');
		const doom = routes.resolve({ url: '/feed/doom/42' });
		assert.equal(doom.overlay.props.creationId, 42);
		assert.equal(doom.backgroundUrl, '/feed');
		const create = routes.resolve({ url: '/create' });
		assert.equal(create.overlay.title, 'Create');
		assert.equal(create.backgroundUrl, '/feed');
	} finally {
		browser.restore();
	}
});

test('an overlay cannot use another overlay route as its background', () => {
	const browser = browserAt('/');
	try {
		const routes = createAppRoutes({ definitions });
		const composition = routes.resolve({
			url: '/creations/8',
			backgroundUrl: '/creations/7',
		});
		assert.equal(composition.backgroundUrl, '/creations');
		assert.equal(composition.outlet.key, 'route:/creations:');
	} finally {
		browser.restore();
	}
});
