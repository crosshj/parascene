import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { createHomeProvider, homeSkeletonItems } from '../client/providers/home/index.js';
import { loadHomeSection } from '../client/providers/home/api.js';

function storage() {
	const data = new Map();
	return {
		get length() { return data.size; },
		key: (index) => [...data.keys()][index],
		getItem: (key) => data.get(key) || null,
		setItem: (key, value) => data.set(key, value),
		removeItem: (key) => data.delete(key)
	};
}

function seed(store, sections) {
	store.setItem('prsn-home-v3:7', JSON.stringify({ version: 1, updatedAt: 1, data: { sections } }));
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function section(delivery, id) {
	return delivery.sections.find((row) => row.id === id);
}

function creation(id, title = 'Creation') {
	return { id, created_image_id: id, title, image_url: `https://cdn.example/${id}.png`, media_type: 'image' };
}

function snapshot(rows) {
	return ['feed', 'challenges', 'commented', 'explore', 'articles'].map((id) => ({
		id,
		items: rows[id] || []
	}));
}

test('an empty cache delivers every skeleton, then one snapshot when the cache exists', async () => {
	const store = storage();
	const gates = new Map();
	const home = createHomeProvider({
		viewerId: 7,
		storage: () => store,
		loadSection(id) {
			const gate = deferred();
			gates.set(id, gate);
			return gate.promise;
		}
	});
	const seen = [];
	home.observe((delivery) => {
		seen.push(delivery.sections.map((row) => ({
			id: row.id,
			status: row.status,
			skeleton: row.items.length > 0 && row.items.every((item) => item.skeleton),
			count: row.items.length,
			first: row.items[0]?.id || row.items[0]?.challengeId || null
		})));
	});

	assert.equal(seen.length, 1);
	assert.equal(seen[0].length, 5);
	assert.ok(seen[0].every((row) => row.skeleton && row.count === homeSkeletonItems().length && row.status === 'loading'));
	assert.ok(homeSkeletonItems().every((item) => item.width === item.height));

	await Promise.resolve();
	gates.get('challenges').resolve({ items: [{ challengeId: 'weekly', title: 'Weekly', image: 'https://cdn.example/weekly.png', width: 400, height: 300 }] });
	for (let i = 0; i < 8; i += 1) await Promise.resolve();
	assert.equal(seen.length, 1);

	gates.get('feed').resolve({ items: [creation(2, 'Fresh')] });
	for (const id of ['commented', 'explore', 'articles']) gates.get(id).resolve({ items: [] });
	for (let i = 0; i < 10; i += 1) await Promise.resolve();
	assert.equal(seen.length, 2);
	assert.equal(seen[1].find((row) => row.id === 'feed').first, 2);
	assert.equal(seen[1].find((row) => row.id === 'challenges').first, 'weekly');
	assert.ok(seen[1].every((row) => !row.skeleton && row.status === 'ready'));
	const stored = JSON.parse(store.getItem('prsn-home-v3:7')).data.sections;
	assert.equal(stored.find((row) => row.id === 'feed').items[0].id, 2);
	assert.equal(stored.find((row) => row.id === 'challenges').items[0].image, 'https://cdn.example/weekly.png');
	home.destroy();
});

test('a cached home paints every section once and does not call back when storage updates', async () => {
	const store = storage();
	seed(store, snapshot({
		feed: [{ id: 1, created_image_id: 1, title: 'Cached', image: 'https://cdn.example/1.png', width: 300, height: 400 }],
		challenges: [{ challengeId: 'weekly', title: 'Weekly', image: 'https://cdn.example/weekly.png', width: 400, height: 300 }]
	}));
	const gates = new Map();
	const home = createHomeProvider({
		viewerId: 7,
		storage: () => store,
		loadSection(id) {
			const gate = deferred();
			gates.set(id, gate);
			return gate.promise;
		}
	});
	const seen = [];
	home.observe((delivery) => {
		seen.push({
			feed: section(delivery, 'feed').items[0],
			challenges: section(delivery, 'challenges').items[0],
			count: delivery.sections.length,
			unauthorized: delivery.unauthorized
		});
	});
	assert.equal(seen.length, 1);
	assert.equal(seen[0].count, 5);
	assert.equal(seen[0].unauthorized, false);
	assert.equal(seen[0].feed.id, 1);
	assert.equal(seen[0].feed.image, 'https://cdn.example/1.png');
	assert.equal(seen[0].feed.width, 300);
	assert.equal(seen[0].challenges.image, 'https://cdn.example/weekly.png');

	await Promise.resolve();
	for (const [id, gate] of gates) gate.resolve({ items: id === 'feed' ? [creation(9, 'Next')] : [] });
	for (let i = 0; i < 10; i += 1) await Promise.resolve();
	assert.equal(seen.length, 1);
	assert.equal(JSON.parse(store.getItem('prsn-home-v3:7')).data.sections.find((row) => row.id === 'feed').items[0].id, 9);

	const second = [];
	home.observe((delivery) => second.push(section(delivery, 'feed').items[0].id));
	assert.equal(second[0], 9);
	home.destroy();
});

test('clearing the home cache drops the snapshot, and the next visit starts from skeletons', async () => {
	const store = storage();
	const home = createHomeProvider({
		viewerId: 7,
		storage: () => store,
		loadSection: async (id) => ({ items: id === 'explore' ? [creation(8)] : [] })
	});
	let latest = null;
	home.observe((delivery) => { latest = delivery; });
	for (let i = 0; i < 8; i += 1) await Promise.resolve();
	assert.equal(section(latest, 'explore').status, 'ready');
	assert.ok(store.getItem('prsn-home-v3:7'));
	home.clearCache();
	assert.equal(store.getItem('prsn-home-v3:7'), null);
	const next = createHomeProvider({
		viewerId: 7,
		storage: () => store,
		loadSection: () => new Promise(() => {})
	});
	let first = null;
	next.observe((delivery) => { if (!first) first = section(delivery, 'explore').items; });
	assert.equal(first.length, homeSkeletonItems().length);
	assert.ok(first.every((item) => item.skeleton));
	home.destroy();
	next.destroy();
});

test('home sections are normalized rows, not the source payloads', async () => {
	const posts = [
		{ slug: 'kept', title: 'Kept', image_url: 'https://cdn.example/post.png' },
		{ slug: 'bare', title: 'Bare', image_url: '' }
	];
	const fetchJson = async (path) => {
		if (path.startsWith('/api/feed')) {
			return { ok: true, status: 200, data: { items: [
				{ type: 'tip', id: 1 },
				{ editorial_pin: true, editorial_pin_id: 'challenge-9', created_image_id: 2, image_url: 'https://cdn.example/pin.png' },
				creation(3, 'Shown')
			] } };
		}
		if (path.startsWith('/api/comments/latest')) {
			return { ok: true, status: 200, data: { comments: [
				{ created_image_id: 5, creation: { ...creation(5, 'Commented'), width: 800, height: 450 } },
				{ created_image_id: 6, creation: { ...creation(6), media_type: 'audio', audio_url: 'https://cdn.example/a.mp3' } }
			] } };
		}
		if (path.startsWith('/api/explore')) {
			return { ok: true, status: 200, data: { items: [creation(7, 'Explore'), { ...creation(8), media_type: 'audio', audio_url: 'https://cdn.example/b.mp3' }] } };
		}
		if (path.startsWith('/api/blog/published')) return { ok: true, status: 200, data: { posts } };
		return { ok: false, status: 500, data: {} };
	};
	const feed = await loadHomeSection('feed', { fetchJson });
	assert.deepEqual(feed.items.map((item) => item.id), [3]);
	const commented = await loadHomeSection('commented', { fetchJson });
	assert.deepEqual(commented.items.map((item) => item.id), [5]);
	assert.equal(commented.items[0].width, 800);
	assert.equal(commented.items[0].height, 450);
	const explore = await loadHomeSection('explore', { fetchJson });
	assert.deepEqual(explore.items.map((item) => item.id), [7]);
	const articles = await loadHomeSection('articles', { fetchJson });
	assert.deepEqual(articles.items.map((post) => post.slug), ['kept']);

	await assert.rejects(
		() => loadHomeSection('explore', { fetchJson: async () => ({ ok: false, status: 401, data: {} }) }),
		(error) => error.status === 401
	);
});

test('the home view renders delivered rows and leaves source assembly to the provider', { skip: !vm.SourceTextModule }, async () => {
	const source = fs.readFileSync(path.resolve('client/views/Home/HomeView.js'), 'utf8');
	assert.equal(source.includes('fetchJson'), false);
	assert.equal(source.includes('loadChallengeCards'), false);
	assert.equal(source.includes('providers.home'), true);

	const dom = new JSDOM('<div class="app-outlet__frame"><div id="outlet"></div></div>', { url: 'http://localhost/', pretendToBeVisual: true });
	const window = dom.window;
	window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
	const names = ['document', 'HTMLElement', 'HTMLDivElement', 'HTMLAnchorElement', 'HTMLImageElement', 'Element', 'Node', 'Event', 'location'];
	const context = vm.createContext({
		...Object.fromEntries(names.map((name) => [name, window[name]])),
		window,
		console,
		URL,
		URLSearchParams,
		matchMedia: window.matchMedia,
		setTimeout,
		clearTimeout,
		queueMicrotask
	});
	const modules = new Map();
	function moduleFor(file) {
		file = path.resolve(file);
		if (modules.has(file)) return modules.get(file);
		let code = fs.readFileSync(file, 'utf8');
		if (file.endsWith('.css')) code = 'export default {}';
		if (file.endsWith('.html')) code = `export default ${JSON.stringify(code)}`;
		const mod = new vm.SourceTextModule(code, { identifier: file, context });
		modules.set(file, mod);
		return mod;
	}
	async function load(file) {
		const mod = moduleFor(path.resolve('client', file));
		if (mod.status === 'unlinked') {
			await mod.link((specifier, parent) => moduleFor(path.resolve(path.dirname(parent.identifier), specifier)));
		}
		if (mod.status !== 'evaluated') await mod.evaluate();
		return mod.namespace;
	}
	const { HomeView } = await load('views/Home/HomeView.js');
	let listener = null;
	let redirects = 0;
	const home = {
		observe(next) {
			listener = next;
			next(delivery());
			return () => { listener = null; };
		}
	};
	function delivery(extra = {}) {
		return {
			unauthorized: false,
			sections: [
				{ id: 'feed', title: 'Feed', href: '/feed', kind: 'creation', empty: 'Nothing new in the feed.', status: 'stale', errorStatus: 0, items: [creation(9, 'Cached')] },
				{ id: 'challenges', title: 'Challenges', href: '/challenges', kind: 'challenge', empty: 'No challenges yet.', status: 'loading', errorStatus: 0, items: [
					{ skeleton: true, width: 168, height: 268 },
					{ skeleton: true, width: 240, height: 268 }
				] },
				{ id: 'commented', title: 'Commented', href: '/comments', kind: 'creation', empty: 'No comments yet.', status: 'ready', errorStatus: 0, items: [] },
				{ id: 'explore', title: 'Explore', href: '/explore', kind: 'creation', empty: 'Nothing here.', status: 'error', errorStatus: 500, items: [] },
				{ id: 'articles', title: 'Articles', href: '/blog', kind: 'article', empty: 'No articles yet.', status: 'ready', errorStatus: 0, items: [{ slug: 'note', title: 'Note', image_url: 'https://cdn.example/note.png' }] },
				...[]
			],
			...extra
		};
	}
	const outlet = window.document.getElementById('outlet');
	const handle = HomeView.mount({
		outlet,
		actions: { navigate() {} },
		services: {
			session: { redirectToLogin() { redirects += 1; } },
			providers: { document: { setTitle() {} }, home }
		}
	});
	const feed = outlet.querySelector('[data-home-section="feed"]');
	assert.ok(feed.querySelector('a[href="/creations/9"]'));
	assert.equal(feed.querySelector('.home-tile--more .home-tile__more-label').textContent, '+ More');
	assert.ok(feed.querySelector('.home-tile--more .home-tile__more-mark rect'));
	assert.equal(outlet.querySelectorAll('[data-home-section="challenges"] .home-tile--skeleton').length, 2);
	assert.equal(outlet.querySelector('[data-home-section="challenges"] .home-tile--skeleton').getAttribute('style'), 'width:168px;height:268px');
	assert.equal(outlet.querySelector('[data-home-section="challenges"]').getAttribute('aria-busy'), 'true');
	assert.equal(outlet.querySelector('[data-home-section="commented"] .home-empty').textContent, 'No comments yet.');
	assert.equal(outlet.querySelector('[data-home-section="explore"] .home-empty').textContent, 'Could not load this section.');
	assert.ok(outlet.querySelector('[data-home-section="articles"] a[href="/blog/n/note"]'));

	listener({
		unauthorized: false,
		sections: delivery().sections.map((row) => row.id === 'challenges'
			? { ...row, status: 'ready', items: [{ challengeId: 'weekly', title: 'Weekly', image: 'https://cdn.example/weekly.png' }] }
			: row)
	});
	assert.equal(outlet.querySelector('[data-home-section="feed"]'), feed);
	assert.ok(outlet.querySelector('[data-home-section="challenges"] a[href="/challenges/details/weekly"]'));

	listener({ unauthorized: true, sections: delivery().sections });
	assert.equal(redirects, 1);
	assert.equal(outlet.querySelector('[data-home-section="feed"]'), feed);
	handle.destroy();
	window.close();
});
