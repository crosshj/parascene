import { createChatApi } from './api.js';
import { createChatInboxQuery } from './query.js';

export function createChatProvider({ viewerId, registry } = {}) {
	const api = createChatApi();
	const inbox = viewerId ? createChatInboxQuery({ viewerId, api }) : null;
	const lease = inbox ? registry.acquire(['chat-inbox', viewerId], () => inbox.query) : null;
	const query = lease?.query || null;

	return {
		api,
		query,
		preload() { if (query) void query.loadIfNeeded().catch(() => undefined); },
		syncExternalCache(event) { inbox?.syncExternalCache(event); },
		clearCache() { inbox?.clearCache(); },
	};
}
