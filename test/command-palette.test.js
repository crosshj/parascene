import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const threads = [
	{
		type: 'dm',
		id: 3,
		other_user: { id: 8, user_name: 'Ada', display_name: 'Ada Lovelace' },
		unread_count: 2,
		last_message: { created_at: '2026-10-06T12:00:00Z' },
	},
	{
		type: 'channel',
		id: 9,
		channel_slug: 'general',
		title: 'General',
		unread_count: 0,
		last_message: { created_at: '2026-10-05T12:00:00Z' },
	},
	{
		type: 'channel',
		id: 4,
		channel_slug: 'secret',
		title: 'Secret',
		visibility: 'private',
	},
];

function harness() {
	const dom = new JSDOM('<!doctype html><html><body></body></html>', {
		url: 'http://localhost/feed',
		pretendToBeVisual: true,
	});
	const view = dom.window;
	view.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
	const names = ['document', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'CustomEvent', 'navigator'];
	const context = vm.createContext({
		...Object.fromEntries(names.map((name) => [name, view[name]])),
		window: view,
		console,
		setTimeout,
		clearTimeout,
		requestAnimationFrame: (callback) => setTimeout(callback, 0),
		cancelAnimationFrame: clearTimeout,
	});
	const modules = new Map();
	function module(file) {
		file = path.resolve(file);
		if (modules.has(file)) return modules.get(file);
		let code = fs.readFileSync(file, 'utf8');
		if (file.endsWith('.css')) code = 'export default {}';
		const mod = new vm.SourceTextModule(code, { identifier: file, context });
		modules.set(file, mod);
		return mod;
	}
	async function load(file) {
		const mod = module(path.resolve('client', file));
		if (mod.status === 'unlinked') {
			await mod.link((specifier, parent) => module(path.resolve(path.dirname(parent.identifier), specifier)));
		}
		if (mod.status !== 'evaluated') await mod.evaluate();
		return mod.namespace;
	}
	return { view, load, close: () => dom.window.close() };
}

test('command palette lists VPS places, channels, and direct messages', { skip: !vm.SourceTextModule }, async () => {
	const h = harness();
	try {
		const { buildCommandPaletteItems, filterCommandPaletteItems } = await h.load('shared/commandPalette/commandPaletteProvider.js');
		const items = buildCommandPaletteItems({
			getThreads: () => threads,
			getJoinedServers: () => [{ id: 2, name: 'Studio' }],
		});
		const byTitle = new Map(items.map((item) => [item.title, item]));
		assert.equal(byTitle.get('Feed').href, '/feed');
		assert.equal(byTitle.get('My Creations').href, '/creations');
		assert.equal(byTitle.get('My Files').href, '/files');
		assert.equal(byTitle.get('Prompt Library').href, '/library');
		assert.equal(byTitle.get('Feedback').href, '/feedback');
		assert.equal(byTitle.get('My Notes').href, '/notes');
		assert.equal(byTitle.get('Ada Lovelace').href, '/dm/ada');
		assert.equal(byTitle.get('Ada Lovelace').unreadCount, 2);
		assert.equal(byTitle.get('General').href, '/ch/general');
		assert.equal(byTitle.get('Secret').href, '/chat/t/4/secret');
		assert.equal(byTitle.get('studio').href, '/ch/studio');
		const idle = filterCommandPaletteItems(items, '');
		assert.equal(idle.groups.map((group) => group.label).join('|'), 'Recent|Places');
		const placeTitles = idle.groups.find((group) => group.id === 'places').items.map((item) => item.title);
		const creationsAt = placeTitles.indexOf('My Creations');
		assert.equal(placeTitles[creationsAt + 1], 'My Files');
		assert.equal(placeTitles[creationsAt + 2], 'My Notes');
		assert.equal(filterCommandPaletteItems(items, 'files').flatItems.map((item) => item.href).join('|'), '/files');
		assert.equal(idle.flatItems[0].title, 'Ada Lovelace');
		const found = filterCommandPaletteItems(items, 'general');
		assert.equal(found.flatItems.map((item) => item.href).join('|'), '/ch/general');
	} finally {
		h.close();
	}
});

test('command palette opens with Ctrl+K and navigates the selected row', { skip: !vm.SourceTextModule }, async () => {
	const h = harness();
	try {
		const navigated = [];
		const { initCommandPalette } = await h.load('shared/commandPalette/commandPalette.js');
		const palette = initCommandPalette({
			getThreads: () => threads,
			getJoinedServers: () => [],
			navigateToPath: (href) => navigated.push(href),
		});
		h.view.document.dispatchEvent(new h.view.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		const overlay = h.view.document.querySelector('[data-command-palette]');
		assert.equal(overlay.classList.contains('open'), true);
		assert.match(overlay.textContent, /Ada Lovelace/);
		overlay.querySelector('.command-palette-item').click();
		assert.deepEqual(navigated, ['/dm/ada']);
		assert.equal(palette.isOpen(), false);
		h.view.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
		h.view.document.dispatchEvent(new h.view.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(palette.isOpen(), false);
		palette.destroy();
		assert.equal(h.view.document.querySelector('[data-command-palette]'), null);
	} finally {
		h.close();
	}
});
