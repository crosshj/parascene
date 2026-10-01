import { createQueryRegistry } from '../core/queryRegistry.js';
import { createChatProvider } from './chat/index.js';
import { createCreationsProvider } from './creations/index.js';
import { createFilesProvider } from './files/index.js';
import { createCreditsProvider } from './credits/index.js';

export function createAppProviders({ bootstrap = {} } = {}) {
	const viewerId = Number(bootstrap.user?.id) || null;
	const registry = createQueryRegistry();
	const providers = {
		chat: createChatProvider({ viewerId, registry }),
		creations: createCreationsProvider({ viewerId, registry }),
		files: createFilesProvider({ viewerId, registry, origin: bootstrap.filesOrigin || '' }),
		credits: createCreditsProvider({ viewerId, registry }),
	};

	return {
		viewerId,
		...providers,
		preload() {
			for (const provider of Object.values(providers)) provider.preload();
		},
		syncExternalCache(event) {
			for (const provider of Object.values(providers)) provider.syncExternalCache(event);
		},
		clearCaches() {
			for (const provider of Object.values(providers)) provider.clearCache();
		},
		destroy() { registry.clear(); },
	};
}
