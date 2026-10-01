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
	{ path: '/feed/doom/:creationId', view: views.DoomScroll, title: 'Doom Scroll', icon: 'chart', presentation: 'overlay', defaultBackground: '/feed', composer: 'none' },
	{ path: '/explore', view: views.Explore, title: 'Explore', icon: 'globe' },
	{ path: '/challenges', view: views.Challenges, title: 'Challenges', icon: 'trophy' },
	{ path: '/challenges/organize', view: views.Challenges, title: 'Organize challenges', viewName: 'Challenges · Organize', icon: 'trophy' },
	{ path: '/challenges/details/:challengeId', view: views.Challenges, title: 'Challenge details', viewName: 'Challenges · Details', icon: 'trophy' },
	{ path: '/comments', view: views.Comments, title: 'Comments', icon: 'comments' },
	{ path: '/ch/:slug', view: views.Channel, titleMode: 'channel', icon: 'comments', composer: 'message' },
	{ path: '/dm/:slug', view: views.DirectMessage, titleMode: 'dm', icon: 'user', composer: 'message' },
	{ path: '/notes', view: views.DirectMessage, titleMode: 'notes', slug: 'self', icon: 'notes', composer: 'message' },
	{ path: '/library', view: views.Library, title: 'Library', icon: 'book' },
	{ path: '/feedback', view: views.Channel, title: 'Feedback', slug: 'feedback', icon: 'megaphone', composer: 'message' },
	{ path: '/creations', view: views.Creations, title: 'My Creations', icon: 'picture' },
	{ path: '/files', view: views.FileManager, title: 'My Files', icon: 'files' },
	{ path: '/create', view: views.Create, presentation: 'overlay', defaultBackground: '/feed', title: 'Create', icon: 'plus', composer: 'none' },
	{ path: '/creations/:creationId', view: views.CreationDetail, icon: 'picture', presentation: 'overlay', defaultBackground: '/creations' },
	{ path: '*', view: views.NotFound, title: 'Not Found', icon: 'info', composer: 'none' },
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
		assert.equal(routes.resolve({ url: '/not-a-route' }).outlet.chrome.icon, 'info');
		assert.equal(routes.resolve({ url: '/not-a-route' }).outlet.chrome.composer, 'none');
		for (const [path, icon] of [
			['/feed', 'home'], ['/explore', 'globe'], ['/challenges', 'trophy'],
			['/challenges/organize', 'trophy'], ['/challenges/details/demo', 'trophy'],
			['/comments', 'comments'], ['/ch/general', 'comments'], ['/dm/example', 'user'],
			['/notes', 'notes'], ['/feedback', 'megaphone'], ['/library', 'book'],
			['/creations', 'picture'], ['/files', 'files'], ['/not-a-route', 'info'],
		]) assert.equal(routes.resolve({ url: path }).outlet.chrome.icon, icon, `Expected ${icon} icon for ${path}`);
		assert.equal(routes.match('/create').icon, 'plus');
		assert.equal(routes.match('/feed/doom/42').icon, 'chart');
		assert.equal(routes.match('/creations/42').icon, 'picture');
		assert.equal(routes.resolve({ url: '/ch/general' }).outlet.chrome.composer, 'message');
		assert.equal(routes.resolve({ url: '/dm/example' }).outlet.chrome.composer, 'message');
		assert.equal(routes.resolve({ url: '/notes' }).outlet.chrome.composer, 'message');
		assert.equal(routes.resolve({ url: '/feedback' }).outlet.chrome.composer, 'message');
		assert.deepEqual(routes.resolve({ url: '/challenges/organize' }).outlet.chrome.breadcrumb, {
			parent: 'Challenges', href: '/challenges', current: 'Organize',
		});
		assert.deepEqual(routes.resolve({ url: '/challenges/details/demo' }).outlet.chrome.breadcrumb, {
			parent: 'Challenges', href: '/challenges', current: 'Details',
		});

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
