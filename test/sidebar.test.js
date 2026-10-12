import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppState } from '../client/core/appState.js';
import { isSidebarRouteActive, parseSidebarPath } from '../client/utils/sidebarRoutes.js';

test('normalizes www-style sidebar route aliases', () => {
	assert.deepEqual(parseSidebarPath('/'), { kind: 'channel', slug: 'feed' });
	assert.deepEqual(parseSidebarPath('/chat/c/feed/doom/42'), { kind: 'channel', slug: 'feed' });
	assert.deepEqual(parseSidebarPath('/challenges/details/9'), { kind: 'channel', slug: 'challenges' });
	assert.deepEqual(parseSidebarPath('/chat/dm/@Quinsy/'), { kind: 'dm', userName: 'quinsy' });
	assert.deepEqual(parseSidebarPath('/chat/t/103/thread-name'), { kind: 'thread', threadId: 103 });
});

test('matches sidebar rows through aliases and canonical thread urls', () => {
	const feed = { path: '/', route: { kind: 'channel', slug: 'feed' } };
	const dm = { path: '/chat/dm/tonygen', route: { kind: 'dm', userName: 'tonygen', threadId: 103 } };
	const files = { path: '/files', route: { kind: 'path', path: '/files' } };
	assert.equal(isSidebarRouteActive(feed, '/chat/c/feed'), true);
	assert.equal(isSidebarRouteActive(feed, '/explore'), false);
	assert.equal(isSidebarRouteActive(dm, '/chat/t/103/friendly-name'), true);
	assert.equal(isSidebarRouteActive(dm, '/chat/t/104'), false);
	assert.equal(isSidebarRouteActive(files, '/files'), true);
});

test('publishes app-owned sidebar state changes', () => {
	const store = createAppState({ count: 1 });
	const seen = [];
	const unsubscribe = store.subscribe((state) => seen.push(state.count));
	store.update((state) => ({ count: state.count + 1 }));
	unsubscribe();
	store.set({ count: 3 });
	assert.equal(store.get().count, 3);
	assert.deepEqual(seen, [2]);
});
