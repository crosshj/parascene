import { createCreateProvider } from './create/index.js';
import { createQueryRegistry } from '../core/queryRegistry.js';
import { createThreadsProvider } from './threads/index.js';
import { createCreationsProvider } from './creations/index.js';
import { createFilesProvider } from './files/index.js';
import { createCreditsProvider } from './credits/index.js';
import { createAvatarsProvider } from './avatars/index.js';

export function createAppProviders({ bootstrap = {} } = {}) {
	const viewerId = Number(bootstrap.user?.id) || null;
	const registry = createQueryRegistry();
	const creations = createCreationsProvider({ viewerId, registry });
	const providers = {
		create: createCreateProvider({ viewerId, pendingCreations: creations.pending }),
		threads: createThreadsProvider({ viewerId, registry }),
		creations,
		files: createFilesProvider({ viewerId, registry, origin: bootstrap.filesOrigin || '' }),
		credits: createCreditsProvider({ viewerId, registry }),
		avatars: createAvatarsProvider(),
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
		destroy() { for (const provider of Object.values(providers)) provider.destroy?.(); registry.clear(); },
	};
}
