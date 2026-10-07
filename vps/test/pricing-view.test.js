import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

function jsonResponse(data, status = 200) {
	return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function harness(fetchImpl) {
	const dom = new JSDOM('<!doctype html><html><body><div id="outlet"></div></body></html>', {
		url: 'http://localhost/feed',
		pretendToBeVisual: true,
	});
	const view = dom.window;
	const names = ['document', 'HTMLElement', 'Element', 'Node', 'Event', 'history', 'location', 'AbortController'];
	const context = vm.createContext({
		...Object.fromEntries(names.map((name) => [name, view[name]])),
		window: view,
		console,
		URL,
		fetch: fetchImpl,
		setTimeout,
		clearTimeout,
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
	return { view, load, outlet: view.document.getElementById('outlet'), close: () => dom.window.close() };
}

test('pricing opens as an overlay over the current page', { skip: !vm.SourceTextModule }, async () => {
	const h = harness(async () => jsonResponse({}));
	try {
		const { createAppRoutes } = await h.load('app/routes.js');
		const routes = createAppRoutes({
			definitions: [
				{ path: '/feed', view: {}, title: 'Feed', composer: 'none' },
				{ path: '/creations', view: {}, title: 'My Creations', composer: 'none' },
				{ path: '/pricing', view: {}, presentation: 'overlay', defaultBackground: '/feed', title: 'Pricing', composer: 'none' },
			],
		});
		const opened = routes.resolve({ url: '/pricing', backgroundUrl: '/creations' });
		assert.equal(opened.overlay.title, 'Pricing');
		assert.equal(opened.backgroundUrl, '/creations');
		assert.equal(opened.outlet.chrome.title, 'My Creations');
		const cold = routes.resolve({ url: '/pricing?topup=1' });
		assert.equal(cold.backgroundUrl, '/feed');
		assert.equal(cold.overlay.props.url, '/pricing?topup=1');
	} finally {
		h.close();
	}
});

test('pricing overlay shows the current plan and a returned credit purchase', { skip: !vm.SourceTextModule }, async () => {
	const h = harness(async (input) => {
		const url = String(input);
		if (url.startsWith('/api/profile')) return jsonResponse({ plan: 'founder', profile: { avatar_url: '' } });
		return jsonResponse({}, 404);
	});
	try {
		const { PricingView } = await h.load('views/Pricing/PricingView.js');
		const mounted = PricingView.mount({ outlet: h.outlet, url: '/pricing' });
		await mounted.backgroundReady;
		const root = h.outlet.querySelector('.pricing-view');
		assert.equal(root.querySelector('[data-pricing-badge-founder]').hidden, false);
		assert.equal(root.querySelector('[data-pricing-badge-free]').hidden, true);
		assert.equal(root.querySelector('[data-pricing-founder]').hidden, true);
		assert.equal(root.querySelector('[data-pricing-switch]').classList.contains('pricing-cta-visible'), true);
		assert.match(root.textContent, /700 credits per month/);
		mounted.destroy();
		assert.equal(h.outlet.querySelector('.pricing-view'), null);

		const returned = PricingView.mount({ outlet: h.outlet, url: '/pricing?topup=1' });
		await returned.backgroundReady;
		assert.match(h.outlet.textContent, /credit pack is being added/);
		assert.equal(h.view.location.pathname, '/pricing');
		assert.equal(h.view.location.search, '');
		returned.destroy();
	} finally {
		h.close();
	}
});
