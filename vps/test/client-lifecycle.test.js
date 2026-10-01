import assert from 'node:assert/strict';
import test from 'node:test';
import { connectLifecycle } from '../client/app/lifecycle.js';

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
		resources: {
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
		assert.deepEqual(order, ['route-paint', 'session-refresh', 'session-state']);
		lifecycle.destroy();
	} finally {
		if (priorWindow === undefined) delete globalThis.window;
		else globalThis.window = priorWindow;
	}
});
