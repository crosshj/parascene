import {createAvatarGenerationQueries} from './avatarGeneration.js';
import {createAccountQueries} from './account.js';
import { createLibraryQueries } from './library.js';
import { createExploreStore } from './explore.js';
import { createCommentsStore } from './comments.js';
import { createSuggestionsStore } from './suggestions.js';
import { createProfileFilesStore } from "./profileFiles.js";
import { createGenericFilesStore } from "./genericFiles.js";
import { createSessionsStore } from "./sessions.js";
import { createSupabaseContext } from "./supabase.js";
import { createUsersStore } from "./users.js";
import { createCreditsStore } from "./credits.js";
import { createCreationsStore } from "./creations.js";
import { createNotificationsStore } from "./notifications.js";
import { createThreadsStore } from './threads.js';
import { createServersStore } from './servers.js';
import { createRealtimeAuthStore } from './realtimeAuth.js';
import { createCreateStore } from './create.js';

export function createDb() {
	const context = createSupabaseContext();
	const users = createUsersStore(context.client);
	const create = createCreateStore(context);
	const creations = createCreationsStore(context);
	const library = { queries: { ...create.queries, ...createLibraryQueries(context.client) }, storage: create.storage };

	return {
 account:{queries:{...library.queries,...createAccountQueries(context.client),...createAvatarGenerationQueries(context.client)},storage:create.storage,users,client:context.client},
		library,
		explore: createExploreStore(context.client),
		create,
		comments: createCommentsStore(context.client, { creations, queries: create.queries || create }),
  suggestions: createSuggestionsStore(context.client),
		users,
		threads: createThreadsStore(context.client, users),
		servers: createServersStore(context.client, users),
		realtimeAuth: createRealtimeAuthStore(context, users),
		credits: createCreditsStore(context.client),
		sessions: createSessionsStore(context.client),
		profileFiles: createProfileFilesStore(context),
		genericFiles: createGenericFilesStore(context),
		creations,
		notifications: createNotificationsStore(context.client)
	};
}
