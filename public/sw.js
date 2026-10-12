/* Minimal beta worker: support installation and take control, while keeping all
 * requests online. The beta prefix also keeps old beta caches isolated. */
self.addEventListener('install', (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		const betaCaches = (await caches.keys()).filter((name) => name.startsWith('parascene-beta-'));
		await Promise.all(betaCaches.map((name) => caches.delete(name)));
		await self.clients.claim();
	})());
});

// A network pass-through keeps the worker eligible for browser install flows
// without introducing stale or cross-account offline responses.
self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	event.respondWith(fetch(event.request));
});
