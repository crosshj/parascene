import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppRoutes } from '../client/app/routes.js';
import { createRouter } from '../client/core/router.js';

const views = {
	Home: {}, Creations: {}, FileManager: {}, MockRoute: {}, CreationDetail: {},
};

const definitions = [
	{ name: 'home', path: '/', view: views.Home },
	{ name: 'creations', path: '/creations', view: views.Creations },
	{ name: 'files', path: '/files', view: views.FileManager },
	{ name: 'creation-detail', path: '/creations/:creationId', view: views.CreationDetail, presentation: 'overlay', defaultBackground: '/creations' },
	{ name: 'fallback', path: '*', view: views.MockRoute },
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
	assert.equal(composition.outlet.key, 'creations');
	assert.equal(composition.overlay.key, 'creation-detail:42');
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
	assert.equal(composition.outlet.key, 'files');
	assert.equal(composition.overlay.props.seed, seed);

	await app.router.navigate('/creations/8');
	composition = app.applied.at(-1);
	assert.equal(composition.backgroundUrl, '/files?kind=audio');
	assert.equal(composition.overlay.key, 'creation-detail:8');

	await app.router.dismissOverlay();
	composition = app.applied.at(-1);
	assert.equal(composition.url, '/files?kind=audio');
	assert.equal(composition.overlay, null);
	assert.deepEqual(app.browser.calls.map(([method]) => method), ['push', 'push', 'replace']);
	app.router.destroy();
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
		assert.equal(composition.outlet.key, 'creations');
	} finally {
		browser.restore();
	}
});
