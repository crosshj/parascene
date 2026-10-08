import { createCreateProvider } from './create/index.js';
import { createQueryRegistry } from '../core/queryRegistry.js';
import { createThreadsProvider } from './threads/index.js';
import { createChallengeHistoryProvider } from './challenges/history.js';
import { createCreationsProvider } from './creations/index.js';
import { createFilesProvider } from './files/index.js';
import { createCreditsProvider } from './credits/index.js';
import { createAvatarsProvider } from './avatars/index.js';
import { createProfileProvider } from './profile/index.js';
import { createPresenceProvider } from './presence/index.js';
import { createNotificationsProvider } from './notifications/index.js';
import { createDocumentProvider } from './document/index.js';

export function createAppProviders({ bootstrap = {} } = {}) {
	const viewerId = Number(bootstrap.user?.id) || null;
	const registry = createQueryRegistry();
	const creations = createCreationsProvider({ viewerId, registry });
	const challengeHistory = createChallengeHistoryProvider({ viewerId });
	const providers = {
		presence: createPresenceProvider({ viewerId }),
		create: createCreateProvider({ viewerId, pendingCreations: creations.pending }),
		threads: createThreadsProvider({
			viewerId,
			registry,
			onChallengeChannel({ threadId, messages }) {
				challengeHistory.applyChannelSnapshot(threadId, messages);
			},
			onChallengePing(threadId) {
				challengeHistory.noteChallengePing(threadId);
			},
		}),
		challengeHistory,
		creations,
		files: createFilesProvider({ viewerId, registry, origin: bootstrap.filesOrigin || '' }),
		credits: createCreditsProvider({ viewerId, registry }),
		avatars: createAvatarsProvider(),
		profile: createProfileProvider(),
		notifications: createNotificationsProvider({ viewerId, registry }),
	};
	providers.document = createDocumentProvider({
		threads: providers.threads,
		notifications: providers.notifications,
		credits: providers.credits,
	});

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
