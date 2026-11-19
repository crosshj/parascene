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
	store.setItem('prsn-home-v11:7', JSON.stringify({ version: 1, updatedAt: 1, data: { sections } }));
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
	return ['images', 'videos', 'songs', 'challenges', 'commented', 'newbies', 'articles'].map((id) => ({
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
	assert.equal(seen[0].length, 7);
	assert.ok(seen[0].every((row) => row.skeleton && row.count === homeSkeletonItems().length && row.status === 'loading'));
	assert.ok(homeSkeletonItems().every((item) => item.width === item.height));

	await Promise.resolve();
	gates.get('challenges').resolve({ items: [{ challengeId: 'weekly', title: 'Weekly', image: 'https://cdn.example/weekly.png', width: 400, height: 300 }] });
	for (let i = 0; i < 8; i += 1) await Promise.resolve();
	assert.equal(seen.length, 1);

	gates.get('images').resolve({ items: [creation(2, 'Fresh')] });
	for (const id of ['videos', 'songs', 'commented', 'newbies', 'articles']) gates.get(id).resolve({ items: [] });
	for (let i = 0; i < 10; i += 1) await Promise.resolve();
	assert.equal(seen.length, 2);
	assert.equal(seen[1].find((row) => row.id === 'images').first, 2);
	assert.equal(seen[1].find((row) => row.id === 'challenges').first, 'weekly');
	assert.ok(seen[1].every((row) => !row.skeleton && row.status === 'ready'));
	const stored = JSON.parse(store.getItem('prsn-home-v11:7')).data.sections;
	assert.equal(stored.find((row) => row.id === 'images').items[0].id, 2);
	assert.equal(stored.find((row) => row.id === 'challenges').items[0].image, 'https://cdn.example/weekly.png');
	home.noteEngagement(2, { like_count: 4, viewer_liked: true, comment_count: 1 });
	const liked = JSON.parse(store.getItem('prsn-home-v11:7')).data.sections.find((row) => row.id === 'images').items[0];
	assert.equal(liked.like_count, 4);
	assert.equal(liked.viewer_liked, true);
	assert.equal(liked.comment_count, 1);
	home.destroy();
});

test('a cached home paints every section once and does not call back when storage updates', async () => {
	const store = storage();
	seed(store, snapshot({
		images: [{ id: 1, created_image_id: 1, title: 'Cached', image: 'https://cdn.example/1.png', width: 300, height: 400 }],
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
			images: section(delivery, 'images').items[0],
			challenges: section(delivery, 'challenges').items[0],
			count: delivery.sections.length,
			unauthorized: delivery.unauthorized
		});
	});
	assert.equal(seen.length, 1);
	assert.equal(seen[0].count, 7);
	assert.equal(seen[0].unauthorized, false);
	assert.equal(seen[0].images.id, 1);
	assert.equal(seen[0].images.image, 'https://cdn.example/1.png');
	assert.equal(seen[0].images.width, 300);
	assert.equal(seen[0].challenges.image, 'https://cdn.example/weekly.png');

	await Promise.resolve();
	for (const [id, gate] of gates) gate.resolve({ items: id === 'images' ? [creation(9, 'Next')] : [] });
	for (let i = 0; i < 10; i += 1) await Promise.resolve();
	assert.equal(seen.length, 1);
	assert.equal(JSON.parse(store.getItem('prsn-home-v11:7')).data.sections.find((row) => row.id === 'images').items[0].id, 9);

	const second = [];
	home.observe((delivery) => second.push(section(delivery, 'images').items[0].id));
	assert.equal(second[0], 9);
	home.destroy();
});

test('clearing the home cache drops the snapshot, and the next visit starts from skeletons', async () => {
	const store = storage();
	const home = createHomeProvider({
		viewerId: 7,
		storage: () => store,
		loadSection: async (id) => ({ items: id === 'newbies' ? [creation(8)] : [] })
	});
	let latest = null;
	home.observe((delivery) => { latest = delivery; });
	for (let i = 0; i < 8; i += 1) await Promise.resolve();
	assert.equal(section(latest, 'newbies').status, 'ready');
	assert.ok(store.getItem('prsn-home-v11:7'));
	home.clearCache();
	assert.equal(store.getItem('prsn-home-v11:7'), null);
	const next = createHomeProvider({
		viewerId: 7,
		storage: () => store,
		loadSection: () => new Promise(() => {})
	});
	let first = null;
	next.observe((delivery) => { if (!first) first = section(delivery, 'newbies').items; });
	assert.equal(first.length, homeSkeletonItems().length);
	assert.ok(first.every((item) => item.skeleton));
	home.destroy();
	next.destroy();
});

test('home sections are normalized rows, not the source payloads', async () => {
	const posts = [
		{ slug: 'kept', title: 'Kept', description: 'A short note', published_at: '2026-01-21T12:00:00.000Z', image_url: 'https://cdn.example/post.png' },
		{ slug: 'bare', title: 'Bare', image_url: '' }
	];
	const fetchJson = async (path) => {
		if (path.startsWith('/api/home/latest')) {
			const type = new URL(path, 'http://local').searchParams.get('type');
			const items = {
				image: [creation(3, 'Shown'), { ...creation(4), media_type: 'video' }],
				video: [
					{ ...creation(11, 'Clip'), media_type: 'video', video_thumbnail_url: 'https://cdn.example/11-poster.jpg', thumbnail_url: 'https://cdn.example/11-square.jpg' },
					{
						...creation(15, 'YouTube'),
						media_type: 'video',
						meta: { media_type: 'video', import: { provider: 'youtube' } },
						url: '/api/creations/media/cover.png?creation_id=15',
						thumbnail_url: '/api/creations/media/cover.png?creation_id=15&variant=thumbnail',
						fit_thumbnail_url: '/api/creations/media/cover.png?creation_id=15&variant=fit',
						width: 1280,
						height: 720
					},
					{
						id: 16,
						created_image_id: 16,
						title: 'Clip file',
						media_type: 'video',
						url: '/api/creations/media/clip.mp4?creation_id=16',
						image_url: '/api/creations/media/clip.mp4?creation_id=16',
						file_path: 'clip.mp4',
						thumbnail_url: '/api/creations/media/still.jpg?creation_id=16&variant=thumbnail',
						video_thumbnail_url: '/api/creations/media/clip.mp4?creation_id=16&variant=video_thumbnail'
					},
					creation(13, 'Still')
				],
				audio: [{ ...creation(12, 'Song'), media_type: 'audio' }, creation(14, 'Poster')]
			}[type] || [];
			return { ok: true, status: 200, data: { items } };
		}
		if (path.startsWith('/api/comments/latest')) {
			return { ok: true, status: 200, data: { comments: [
				{ created_image_id: 5, creation: { ...creation(5, 'Commented'), width: 800, height: 450 } },
				{ created_image_id: 9, creation: { ...creation(9, 'Welcome @ada'), meta: { new_user: true } } },
				{ created_image_id: 6, creation: { ...creation(6), media_type: 'audio', audio_url: 'https://cdn.example/a.mp3' } }
			] } };
		}
		if (path.startsWith('/api/home/newbies')) {
			return { ok: true, status: 200, data: { items: [creation(7, 'Welcome @ada'), creation(8, 'Profile portrait')] } };
		}
		if (path.startsWith('/api/blog/published')) return { ok: true, status: 200, data: { posts } };
		return { ok: false, status: 500, data: {} };
	};
	const images = await loadHomeSection('images', { fetchJson });
	assert.deepEqual(images.items.map((item) => item.id), [3]);
	const videos = await loadHomeSection('videos', { fetchJson });
	assert.deepEqual(videos.items.map((item) => item.id), [11, 15, 16]);
	assert.equal(videos.items[0].image, 'https://cdn.example/11-poster.jpg');
	assert.equal(videos.items[1].image, '/api/creations/media/cover.png?creation_id=15');
	assert.equal(videos.items[2].image, '/api/creations/media/clip.mp4?creation_id=16&variant=video_thumbnail');
	const songs = await loadHomeSection('songs', { fetchJson });
	assert.deepEqual(songs.items.map((item) => item.id), [12]);
	assert.equal(songs.items[0].media_type, 'audio');
	const commented = await loadHomeSection('commented', { fetchJson });
	assert.deepEqual(commented.items.map((item) => item.id), [5]);
	assert.equal(commented.items[0].width, 800);
	assert.equal(commented.items[0].height, 450);
	const newbies = await loadHomeSection('newbies', { fetchJson });
	assert.deepEqual(newbies.items.map((item) => item.id), [7, 8]);
	const articles = await loadHomeSection('articles', { fetchJson });
	assert.deepEqual(articles.items.map((post) => post.slug), ['kept']);
	assert.equal(articles.items[0].description, 'A short note');
	assert.equal(articles.items[0].published_at, '2026-01-21T12:00:00.000Z');

	await assert.rejects(
		() => loadHomeSection('newbies', { fetchJson: async () => ({ ok: false, status: 401, data: {} }) }),
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
	const names = ['document', 'Document', 'HTMLElement', 'HTMLButtonElement', 'HTMLDivElement', 'HTMLAnchorElement', 'HTMLImageElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'location'];
	const context = vm.createContext({
		...Object.fromEntries(names.map((name) => [name, window[name]])),
		window,
		Date,
		Intl,
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
				{ id: 'images', title: 'Images', href: '/feed', kind: 'creation', empty: 'No images yet.', status: 'stale', errorStatus: 0, items: [creation(9, 'Cached')] },
				{ id: 'videos', title: 'Videos', href: '/feed', kind: 'creation', empty: 'No videos yet.', status: 'ready', errorStatus: 0, items: [creation(10, 'Clip')] },
				{ id: 'songs', title: 'Songs', href: '/feed', kind: 'creation', empty: 'No songs yet.', status: 'ready', errorStatus: 0, items: [creation(11, 'Song')] },
				{ id: 'challenges', title: 'Challenges', href: '/challenges', kind: 'challenge', empty: 'No challenges yet.', status: 'loading', errorStatus: 0, items: [
					{ skeleton: true, width: 168, height: 268 },
					{ skeleton: true, width: 240, height: 268 }
				] },
				{ id: 'commented', title: 'Comments', href: '/comments', kind: 'creation', empty: 'No comments yet.', status: 'ready', errorStatus: 0, items: [{ ...creation(15, 'Noted'), width: 9, height: 16, like_count: 3, comment_count: 300, viewer_liked: true, liked_by: ['@ada'], commented_by: ['@cy', 2] }] },
				{ id: 'newbies', title: 'Newbies', href: '/explore', kind: 'creation', empty: 'No new people yet.', status: 'error', errorStatus: 500, items: [] },
				{ id: 'articles', title: 'Articles', href: '/blog', kind: 'article', empty: 'No articles yet.', status: 'ready', errorStatus: 0, items: [{ slug: 'note', title: 'Note', description: 'A short note', published_at: '2026-01-21T12:00:00.000Z', image_url: 'https://cdn.example/note.png' }] },
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
	const images = outlet.querySelector('[data-home-section="images"]');
	assert.ok(images.querySelector('a[href="/creations/9"]'));
	assert.equal(images.querySelector('.home-tile--more .home-tile__more-label').textContent, '+ More');
	assert.ok(images.querySelector('.home-tile--more .home-tile__more-mark rect'));
	for (const id of ['images', 'videos', 'songs']) {
		const section = outlet.querySelector(`[data-home-section="${id}"]`);
		assert.equal(section.querySelector('.home-section__link').getAttribute('href'), '/feed');
		assert.equal(section.querySelector('.home-tile--more').getAttribute('href'), '/feed');
	}
	assert.equal(outlet.querySelectorAll('[data-home-section="challenges"] .home-tile--skeleton').length, 2);
	assert.equal(outlet.querySelector('[data-home-section="challenges"] .home-row--challenge .home-tile--skeleton').hasAttribute('style'), false);
	assert.equal(outlet.querySelector('[data-home-section="challenges"]').getAttribute('aria-busy'), 'true');
	const comments = outlet.querySelector('[data-home-section="commented"] .home-tile--media');
	assert.equal(comments.getAttribute('style'), 'width:158px;height:280px');
	assert.equal(comments.querySelector('[data-home-comment-count]').textContent, '300');
	assert.equal(comments.querySelector('[data-like-count]').textContent, '3');
	assert.equal(comments.querySelector('button[data-like-button]').getAttribute('aria-pressed'), 'true');
	assert.equal(comments.querySelector('button[data-like-button]').closest('a'), null);
	assert.equal(comments.querySelector('button[data-like-button]').getAttribute('data-tooltip'), '@ada');
	assert.equal(comments.querySelector('.home-tile__stat--comment').getAttribute('data-tooltip'), '@cy, and 2 others');
	assert.equal(images.querySelector('[data-home-comment-count]'), null);
	assert.ok(images.querySelector('button[data-like-button]'));
	assert.equal(outlet.querySelector('[data-home-section="newbies"] .home-empty').textContent, 'Could not load this section.');
	const article = outlet.querySelector('[data-home-section="articles"] a[href="/blog/n/note"]');
	assert.ok(article);
	assert.equal(article.classList.contains('home-tile--article'), true);
	assert.equal(article.closest('.home-row').classList.contains('home-row--article'), true);
	assert.equal(article.querySelector('.home-article__title').textContent, 'Note');
	assert.equal(article.querySelector('.home-article__summary').textContent, 'A short note');
	assert.match(article.querySelector('.home-article__date').textContent, /2026/);
	assert.equal(article.querySelector('.home-article__img').getAttribute('src'), 'https://cdn.example/note.png');
	assert.equal(article.hasAttribute('style'), false);

	listener({
		unauthorized: false,
		sections: delivery().sections.map((row) => {
			if (row.id === 'challenges') return { ...row, status: 'ready', items: [{ challengeId: 'weekly', title: 'Weekly', image: 'https://cdn.example/weekly.png', phase: 'voting', phaseLabel: 'voting', status: 'Voting open', timeLeft: '1 day left to vote', stats: [{ key: 'creators', label: 'Creators entered', value: '4' }, { key: 'entries', label: 'Entries so far', value: '6' }, { key: 'votes', label: 'Total votes', value: '5' }] }] };
			if (row.id === 'newbies') return { ...row, status: 'ready', errorStatus: 0, items: [{ ...creation(8, 'Profile portrait'), user_name: 'ada' }] };
			return row;
		})
	});
	assert.equal(outlet.querySelector('[data-home-section="images"]'), images);
	const challenge = outlet.querySelector('[data-home-section="challenges"] a[href="/challenges/details/weekly"]');
	assert.ok(challenge);
	assert.equal(challenge.classList.contains('home-tile--challenge'), true);
	assert.equal(challenge.querySelector('.home-challenge__status').textContent, 'Voting open');
	assert.equal(challenge.querySelector('.home-challenge__time span').textContent, '1 day left to vote');
	assert.equal(challenge.querySelectorAll('.home-challenge__stat').length, 3);
	assert.equal(challenge.hasAttribute('style'), false);
	const newbie = outlet.querySelector('[data-home-section="newbies"] a[href="/creations/8"]');
	assert.equal(newbie.querySelector('.home-tile__name').textContent, '@ada');
	assert.equal(newbie.getAttribute('aria-label'), '@ada, Profile portrait');
	assert.equal(outlet.querySelector('[data-home-section="newbies"] .home-section__link').getAttribute('href'), '/explore');
	assert.equal(outlet.querySelector('[data-home-section="newbies"] .home-tile--more').getAttribute('href'), '/explore');
	assert.equal(images.querySelector('.home-tile__name'), null);

	listener({ unauthorized: true, sections: delivery().sections });
	assert.equal(redirects, 1);
	assert.equal(outlet.querySelector('[data-home-section="images"]'), images);
	handle.destroy();
	window.close();
});
