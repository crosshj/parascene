import assert from 'node:assert/strict';
import test from 'node:test';
import { connectLifecycle } from '../client/app/lifecycle.js';
import { createAppState } from '../client/core/appState.js';

test('startup paints the route before session refresh and does not broadly preload resources', async () => {
	const priorWindow = globalThis.window;
	globalThis.window = new EventTarget();
	const order = [];
	const lifecycle = connectLifecycle({
		state: { actions: { sessionChanged() { order.push('session-state'); } } },
		session: {
			user: { id: 1 },
			async initialize() { order.push('session-refresh'); },
			destroy() {},
		},
		providers: {
			presence: { start() { order.push('presence-start'); } },
			preload() { order.push('resource-preload'); },
			destroy() {},
		},
		router: {
			async start() { order.push('route-paint'); },
			destroy() {},
		},
	});

	try {
		await lifecycle.start();
		assert.deepEqual(order, ['route-paint', 'presence-start', 'session-refresh', 'session-state']);
		lifecycle.destroy();
	} finally {
		if (priorWindow === undefined) delete globalThis.window;
		else globalThis.window = priorWindow;
	}
});

test('native navigation counts as presence activity, unrelated state updates do not, and teardown unsubscribes', async () => {
	const priorWindow = globalThis.window;
	globalThis.window = new EventTarget();
	const navigation = { url: '/feed' };
	const store = createAppState({ navigation });
	let activity = 0;
	const lifecycle = connectLifecycle({
		state: { ...store, actions: { sessionChanged() {} } },
		session: { user: { id: 1 }, async initialize() {}, destroy() {} },
		providers: { presence: { start() {}, markActivity() { activity++; } }, destroy() {} },
		router: { async start() {}, destroy() {} },
	});
	try {
		await lifecycle.start();
		store.set({ navigation, unrelated: true }); assert.equal(activity, 0);
		store.set({ navigation: { url: '/creations' } }); assert.equal(activity, 1);
		store.set({ navigation: { url: '/feed' } }); assert.equal(activity, 2);
		lifecycle.destroy();
		store.set({ navigation: { url: '/files' } }); assert.equal(activity, 2);
	} finally {
		if (priorWindow === undefined) delete globalThis.window;
		else globalThis.window = priorWindow;
	}
});
