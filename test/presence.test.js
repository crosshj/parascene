import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createPresenceProvider } from '../client/providers/presence/index.js';
import { createPresenceHeartbeat } from '../client/providers/presence/heartbeat.js';

const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const response = (data = {}, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const wwwChat = fs.readFileSync(new URL('../../src/chat/chatPage.js', import.meta.url), 'utf8');
function environment(t) {
	const dom = new JSDOM('<meta name="asset-version" content="test-build">', { pretendToBeVisual: true, url: 'http://localhost/feed' });
	for (const key of ['window', 'document', 'navigator', 'localStorage']) {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
		t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
	}
	t.after(() => dom.window.close());
	t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000_000 });
	return dom.window;
}

// Execute the actual WWW heartbeat alongside the port with the same clock and
// events. Assert request times and payloads, not a copied expectation algorithm.
async function heartbeatPair(t, statuses = []) {
	const w = environment(t), traces = [[], []], pending = [[], []];
	let delayed = false;
	const fetcher = index => async (url, options) => {
		const { signal, ...wire } = options;
		traces[index].push(JSON.parse(JSON.stringify({ at: Date.now(), url, ...wire })));
		if (delayed) return new Promise(resolve => pending[index].push(resolve));
		const result = statuses[traces[index].length - 1] ?? 200;
		if (result === 'network') throw Error('Network unavailable');
		return response({}, result);
	};
	const reference = fs.readFileSync(new URL('../../public/shared/presenceHeartbeat.js', import.meta.url), 'utf8').replace('export function', 'function');
	const context = vm.createContext({ window: w, document: w.document, navigator: w.navigator, Date,
		setTimeout, clearTimeout, fetch: fetcher(0) });
	vm.runInContext(reference + '\nstartPresenceHeartbeat();', context);
	const port = createPresenceHeartbeat({ fetchImpl: fetcher(1) });
	t.after(port.destroy); port.start(); port.start(); await settle();
	const equal = () => assert.deepEqual(traces[1], traces[0]);
	equal();
	return { w, port, traces, equal,
		async advance(ms) { t.mock.timers.tick(ms); await settle(); equal(); },
		async event(type, target = w) { target.dispatchEvent(new w.Event(type)); await settle(); equal(); },
		delay(value) { delayed = value; },
		async release() { for (const list of pending) for (const resolve of list.splice(0)) resolve(response()); await settle(); equal(); },
	};
}

test('heartbeat matches WWW startup, exact deadlines, idle and all activity events', async t => {
	const h = await heartbeatPair(t);
	await h.advance(3999); assert.equal(h.traces[1].length, 1);
	await h.advance(1); assert.equal(h.traces[1].length, 2);
	await h.advance(59999); assert.equal(h.traces[1].length, 2);
	await h.advance(1); assert.equal(h.traces[1].length, 3);
	await h.advance(60000); assert.equal(h.traces[1].length, 3); // idle after two minutes
	for (const event of ['pointerdown', 'keydown', 'submit', 'route-change', 'tab-change']) {
		const count = h.traces[1].length;
		await h.event(event); await h.advance(60000);
		assert.equal(h.traces[1].length, count + 1, event);
		await h.advance(60000); await h.advance(60000);
	}
});

test('heartbeat matches WWW hidden/offline recovery without counting connectivity as activity', async t => {
	const h = await heartbeatPair(t);
	await h.advance(4000);
	Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
	await h.event('visibilitychange', document);
	await h.advance(180000); assert.equal(h.traces[1].length, 2);
	Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
	await h.event('visibilitychange', document); assert.equal(h.traces[1].length, 3);
	Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
	await h.event('offline'); await h.advance(180000);
	Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
	await h.event('online'); assert.equal(h.traces[1].length, 3);
	await h.event('tab-change'); await h.advance(60000);
	assert.equal(h.traces[1].length, 4);
	await h.event('pagehide');
	assert.equal(h.traces[1].at(-1).keepalive, true);
});

test('heartbeat matches WWW failure backoff, 401 handling, recovery and overlapping requests', async t => {
	const h = await heartbeatPair(t, [500, 401, 'network', 500, 500, 200]);
	await h.advance(4000);
	for (const delay of [120000, 240000, 300000, 300000, 60000]) {
		await h.event('pointerdown');
		// Maintain recent activity without resetting the backoff deadline.
		for (let left = delay; left > 0; left -= Math.min(60000, left)) {
			await h.event('keydown'); await h.advance(Math.min(60000, left));
		}
	}
	assert.ok(h.traces[1].length >= 6);
	h.delay(true);
	await h.event('visibilitychange', document);
	const count = h.traces[1].length;
	await h.event('online'); await h.advance(60000);
	assert.equal(h.traces[1].length, count); // one in-flight request
	h.delay(false); await h.release(); await h.advance(60000);
});

test('heartbeat matches WWW missing version behavior and response-relative timer scheduling', async t => {
	const h = await heartbeatPair(t);
	document.querySelector('meta').remove();
	await h.advance(4000); await h.advance(60000); assert.equal(h.traces[1].length, 1);
	document.head.innerHTML = '<meta name="asset-version" content="new-build">';
	h.delay(true); await h.event('visibilitychange', document);
	await h.advance(137); h.delay(false); await h.release();
	const count = h.traces[1].length;
	await h.advance(59999); assert.equal(h.traces[1].length, count);
	await h.advance(1); assert.equal(h.traces[1].length, count + 1);
});

function referenceSnapshots(fetch) {
	const start = wwwChat.indexOf('\tasync function fetchPresenceOnlineSnapshot(');
	const end = wwwChat.indexOf('\n\tfunction collectDmOtherUserIdsForPresence(', start);
	const graceStart = wwwChat.indexOf('\tfunction isDmConsideredOnlineWithGrace(');
	const graceEnd = wwwChat.indexOf('\n\t/** Keep first non-empty DM avatar', graceStart);
	return vm.runInNewContext(`
		let lastPresenceOnlineSnapshot = null, lastPresenceOnlineSnapshotAt = 0;
		let lastPresenceLastActiveCache = null, lastPresenceLastActiveCacheAt = 0, lastPresenceLastActiveCacheKey = '';
		const PRESENCE_ONLINE_SNAPSHOT_TTL_MS = 15000, PRESENCE_LAST_ACTIVE_SNAPSHOT_TTL_MS = 15000, DM_OFFLINE_GRACE_MS = 45000;
		const dmLastSeenOnlineAtByUserId = new Map();
		${wwwChat.slice(start, end)}
		${wwwChat.slice(graceStart, graceEnd)}
		({ online: fetchPresenceOnlineSnapshot, active: fetchPresenceLastActiveSnapshot, isOnline: isDmConsideredOnlineWithGrace });
	`, { fetch, Date, Map, Set });
}

test('snapshot parsing, TTL, failure fallbacks and render-time grace match actual WWW functions', async t => {
	environment(t);
	let online = [{ user_id: 7, presence_last_seen_at: new Date(Date.now() - 20000).toISOString() }];
	let active = [{ user_id: 7, last_active_at: new Date(Date.now() - 10000).toISOString() }];
	let mode = 'ok';
	const traces = [[], []];
	const fetcher = i => async (url, options) => {
		traces[i].push([url, options.body]);
		if (mode === 'network') throw Error('Network unavailable');
		if (mode === 'http') return response({}, 500);
		if (mode === 'malformed') return { ok: true, json: async () => { throw Error('Invalid JSON'); } };
		return response({ users: url.endsWith('/online') ? online : active });
	};
	const reference = referenceSnapshots(fetcher(0));
	const provider = createPresenceProvider({ viewerId: 1, fetchImpl: fetcher(1) });
	t.after(provider.destroy);
	provider.setThreads([{ type: 'dm', other_user_id: 7 }, { type: 'dm', other_user_id: 1 }, { type: 'dm', other_user: { id: 7 } }]);
	let referenceOnline;
	const compare = async () => {
		const [snapshot, lastActive] = await Promise.all([reference.online({ allowCached: true }), reference.active([7], { allowCached: true })]);
		referenceOnline = snapshot.onlineIds;
		await provider.refresh();
		assert.deepEqual([...provider.query.data.onlineIds], [...snapshot.onlineIds]);
		assert.deepEqual([...provider.query.data.lastSeenMsByUserId], [...snapshot.lastSeenMsByUserId]);
		assert.deepEqual([...provider.query.data.lastActiveMsByUserId], [...lastActive]);
		assert.deepEqual(traces[1], traces[0]);
		assert.equal(provider.isOnline(7), reference.isOnline(7, referenceOnline));
	};
	await compare();
	assert.equal(provider.lastActiveMs(7), Date.now() - 10000);
	t.mock.timers.tick(14999); await compare(); assert.equal(traces[1].length, 2);
	t.mock.timers.tick(1); online = []; active = []; await compare();
	t.mock.timers.tick(44999);
	assert.equal(provider.isOnline(7), reference.isOnline(7, referenceOnline));
	t.mock.timers.tick(1);
	assert.equal(provider.isOnline(7), false);
	for (const next of ['ok', 'network', 'http', 'malformed']) {
		mode = next; online = [{ user_id: '7', presence_last_seen_at: 'bad' }, { user_id: 'Infinity' }, { user_id: -1 }];
		active = [{ user_id: 7, presence_last_seen_at: new Date(Date.now()).toISOString(), last_active_at: 'bad' }];
		t.mock.timers.tick(15000); await compare();
	}
});

test('roster polling continues while hidden/offline, visibility refresh uses cache, and disposal stops it', async t => {
	const w = environment(t), calls = [];
	const provider = createPresenceProvider({ viewerId: 1, fetchImpl: async url => { calls.push(url); return response({ users: [] }); } });
	t.after(provider.destroy);
	provider.setThreads([{ type: 'dm', other_user_id: 7 }]);
	provider.start(); provider.start(); await settle();
	Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
	Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
	document.dispatchEvent(new w.Event('visibilitychange')); w.dispatchEvent(new w.Event('offline'));
	t.mock.timers.tick(30000); await settle();
	assert.equal(calls.filter(url => url.endsWith('/online')).length, 2);
	assert.equal(calls.filter(url => url.endsWith('/last-active')).length, 2);
	assert.equal(calls.filter(url => url.endsWith('/heartbeat')).length, 1);
	Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
	document.dispatchEvent(new w.Event('visibilitychange')); await settle();
	assert.equal(calls.filter(url => url.endsWith('/online')).length, 2);
	provider.destroy(); const count = calls.length;
	t.mock.timers.tick(300000); await settle(); assert.equal(calls.length, count);
});

test('teardown aborts pending requests, ignores late snapshots and removes listeners', async t => {
	const w = environment(t), pending = [];
	const provider = createPresenceProvider({ viewerId: 1, fetchImpl: (url, options) => new Promise(resolve => pending.push({ url, options, resolve })) });
	provider.start(); await settle(); assert.equal(pending.length, 2);
	provider.destroy();
	for (const call of pending) {
		assert.equal(call.options.signal.aborted, true);
		call.resolve(response({ users: [{ user_id: 7 }] }));
	}
	await settle(); assert.equal(provider.query.data, undefined);
	assert.equal(provider.isOnline(7), false);
	w.dispatchEvent(new w.Event('pagehide')); w.dispatchEvent(new w.Event('online'));
	t.mock.timers.tick(300000); await settle(); assert.equal(pending.length, 2);
});

test('anonymous providers do not send presence requests', async t => {
	environment(t);
	const provider = createPresenceProvider({ fetchImpl: () => { throw Error('Unexpected request'); } });
	provider.start(); await settle(); provider.destroy();
	assert.equal(provider.query.data, undefined);
});

test('cached presence paints after reload, revalidates immediately and clears on logout', async t => {
	environment(t);
	const one = createPresenceProvider({ viewerId: 1, fetchImpl: async () => response({ users: [{ user_id: 7 }] }) });
	await one.refresh(); one.destroy();
	const two = createPresenceProvider({ viewerId: 1, fetchImpl: async () => response({ users: [] }) });
	assert.equal(two.isOnline(7), true);
	await two.refresh();
	assert.deepEqual([...two.query.data.onlineIds], []);
	t.mock.timers.tick(45000); assert.equal(two.isOnline(7), false);
	const other = createPresenceProvider({ viewerId: 2 });
	assert.equal(other.query.data, undefined); other.destroy();
	two.clearCache();
	const three = createPresenceProvider({ viewerId: 1 });
	assert.equal(three.query.data, undefined); three.destroy();
});

test('presence ranking matches WWW for online, recent, stale, tied and collapsed rows', () => {
	const constantsStart = wwwChat.indexOf('\tconst DM_PROMOTION_RECENT_ACTIVE_WINDOW_MS');
	const constantsEnd = wwwChat.indexOf('\t/** @type {Map<number, number>} */', constantsStart);
	const functionStart = wwwChat.indexOf('\tfunction prioritizeOnlineDmsInVisibleWindow(');
	const functionEnd = wwwChat.indexOf('\n\tfunction dispatchChatUnreadRefresh()', functionStart);
	const now = 1_800_000_000_000;
	const context = { Date: { now: () => now }, rosterMod: { CHAT_SIDEBAR_COLLAPSE_LIST_CAP: 5 } };
	const reference = vm.runInNewContext(wwwChat.slice(constantsStart, constantsEnd) + wwwChat.slice(functionStart, functionEnd) + '\nprioritizeOnlineDmsInVisibleWindow;', context);
	const source = fs.readFileSync(new URL('../client/views/Sidebar/presenceOrder.js', import.meta.url), 'utf8')
		.replace(/^import .*;$/m, 'const CHAT_SIDEBAR_COLLAPSE_LIST_CAP = 5;').replace('export function', 'function');
	const actual = vm.runInNewContext(source + '\nprioritizeOnlineDmsInVisibleWindow;', { ...context });
	let seed = 42;
	const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
	for (let trial = 0; trial < 300; trial++) {
		const rows = Array.from({ length: trial % 23 }, (_, id) => ({ id, online: random() < .35,
			seen: [0, now, now - 900000, now - 900001, now - 3600000][Math.floor(random() * 5)],
			interacted: [0, now - 1000, now - 600000, now - 86400000][Math.floor(random() * 4)],
		}));
		const before = JSON.stringify(rows);
		const options = { visibleCap: [undefined, 1, 3, 5, 9][trial % 5], isOnline: row => row.online,
			getLastSeenMs: row => row.seen, getLastInteractedMs: row => row.interacted };
		assert.deepEqual(Array.from(actual(rows, options), row => row.id), Array.from(reference(rows, options), row => row.id), `scenario ${trial}`);
		assert.equal(JSON.stringify(rows), before);
	}
});

test('mounted sidebar updates presence while retaining its DM row and avatar', { skip: !vm.SourceTextModule }, async () => {
	const dom = new JSDOM('<main></main>', { url: 'http://localhost/feed', pretendToBeVisual: true });
	const w = dom.window;
	const names = ['document', 'navigator', 'location', 'HTMLElement', 'HTMLTemplateElement', 'HTMLAnchorElement', 'Element', 'Node', 'CustomEvent', 'localStorage'];
	const context = vm.createContext({ ...Object.fromEntries(names.map(name => [name, w[name]])), window: w,
		console, structuredClone, URL, URLSearchParams, setTimeout, clearTimeout,
		CSS: { escape: value => value }, ResizeObserver: class { observe() {} disconnect() {} },
		requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w),
	});
	const modules = new Map();
	function module(file) {
		if (modules.has(file)) return modules.get(file);
		let code = fs.readFileSync(file, 'utf8');
		if (file.endsWith('.css')) code = 'export default {}';
		if (file.endsWith('.html')) code = `export default ${JSON.stringify(code)}`;
		const result = new vm.SourceTextModule(code, { identifier: file, context });
		modules.set(file, result); return result;
	}
	async function load(relative) {
		const entry = module(path.resolve('client', relative));
		if (entry.status === 'unlinked') await entry.link((name, parent) => module(path.resolve(path.dirname(parent.identifier), name)));
		if (entry.status !== 'evaluated') await entry.evaluate();
		return entry.namespace;
	}
	let mounted;
	try {
		for (const name of ['app-modal-profile', 'app-modal-about']) w.customElements.define(name, class extends w.HTMLElement { close() {} });
		const { createQuery } = await load('core/query.js');
		const presence = createQuery({ initialData: new Set(), load: async () => new Set() });
		const threads = createQuery({ initialData: { viewerId: 1, servers: [], threads: [{ id: 9, type: 'dm', other_user: { id: 7, user_name: 'friend', avatar_url: '/avatar.png' } }] }, load: async () => { throw Error('Unexpected inbox refresh'); } });
		const { mountSidebarView } = await load('views/Sidebar/SidebarView.js');
		mounted = mountSidebarView({ outlet: w.document.querySelector('main'), actions: {}, services: {
			providers: { viewerId: 1, threads: { query: threads }, credits: {}, presence: { query: presence, setThreads() {}, isOnline: id => presence.data.has(Number(id)), lastActiveMs: () => 0 } },
			session: { user: { id: 1 }, logout() {} },
			state: { selectors: { sidebarPreference: () => ({}) }, get: () => ({}), subscribe: () => () => {} },
		} });
		const row = mounted.root.querySelector('[data-sidebar-item="dm-9"]');
		const avatar = row.querySelector('img');
		assert.ok(avatar);
		assert.ok(row.classList.contains('is-offline'));
		presence.setData(new Set([7]));
		assert.ok(row.classList.contains('is-online'));
		assert.equal(mounted.root.querySelector('[data-sidebar-item="dm-9"]'), row);
		assert.equal(row.querySelector('img'), avatar);
		presence.setData(new Set());
		assert.ok(row.classList.contains('is-offline'));
		threads.setData({ viewerId: 1, servers: [], threads: Array.from({ length: 8 }, (_, i) => ({
			id: i + 11, type: 'dm', other_user: { id: i + 11, user_name: `friend${i}`, avatar_url: `/avatar${i}.png` },
			unread_count: i === 6 ? 1 : 0,
		})) });
		const promoted = mounted.root.querySelector('[data-sidebar-item="dm-18"]');
		const promotedAvatar = promoted.querySelector('img');
		presence.setData(new Set([18]));
		const ordered = [...mounted.root.querySelectorAll('[data-sidebar-item^="dm-"]')].map(el => el.dataset.sidebarItem);
		assert.deepEqual(ordered.slice(0, 2), ['dm-17', 'dm-18']); // unread follows presence ordering
		assert.equal(mounted.root.querySelector('[data-sidebar-item="dm-18"]'), promoted);
		assert.equal(promoted.querySelector('img'), promotedAvatar);
		assert.ok(promoted.classList.contains('is-online'));
		mounted.destroy(); mounted = null;
		presence.setData(new Set([7]));
		assert.equal(w.document.querySelector('[data-sidebar-item="dm-9"]'), null);
	} finally { mounted?.destroy(); dom.window.close(); }
});
