import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

async function loadMenu(url) {
	const dom = new JSDOM('<div id="outlet"></div>', { url, pretendToBeVisual: true });
	const w = dom.window;
	const names = ['document', 'Document', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'customElements', 'location'];
	const context = vm.createContext({
		...Object.fromEntries(names.map((name) => [name, w[name]])),
		window: w,
		console,
		URL,
		requestAnimationFrame: (fn) => fn(),
		cancelAnimationFrame() {},
		innerWidth: 1200,
		innerHeight: 800,
		fetch: async () => new Response('{}', { headers: { 'content-type': 'application/json' } })
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
	const entry = module(path.resolve('client/elements/modals/account-menu.js'));
	await entry.link((specifier, parent) => module(path.resolve(path.dirname(parent.identifier), specifier)));
	await entry.evaluate();
	const menu = w.document.createElement('app-account-menu');
	w.document.body.append(menu);
	return { dom, menu };
}

test('reports menu item is absent on a deployed host', { skip: !vm.SourceTextModule }, async () => {
	const { dom, menu } = await loadMenu('https://beta.parascene.com/');
	try {
		assert.equal(menu.shadowRoot.querySelector('[data-reports-item]'), null);
		assert.doesNotMatch(menu.shadowRoot.textContent, /Reports/);
	} finally {
		dom.window.close();
	}
});

test('reports menu item shows on localhost when opened from the sidebar', { skip: !vm.SourceTextModule }, async () => {
	const { dom, menu } = await loadMenu('http://localhost:3000/');
	try {
		const item = menu.shadowRoot.querySelector('[data-reports-item]');
		assert.ok(item);
		assert.equal(item.hidden, true);
		const anchor = dom.window.document.createElement('button');
		anchor.setAttribute('data-menu-key', 'account');
		await menu.open(anchor);
		assert.equal(item.hidden, false);
		assert.match(menu.shadowRoot.querySelector('style').textContent, /\[hidden\][\s\S]*display:\s*none\s*!important/);
	} finally {
		dom.window.close();
	}
});
