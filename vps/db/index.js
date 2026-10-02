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

export function createDb() {
	const context = createSupabaseContext();
	const users = createUsersStore(context.client);

	return {
		users,
		threads: createThreadsStore(context.client, users),
		servers: createServersStore(context.client, users),
		realtimeAuth: createRealtimeAuthStore(context, users),
		credits: createCreditsStore(context.client),
		sessions: createSessionsStore(context.client),
		profileFiles: createProfileFilesStore(context),
		genericFiles: createGenericFilesStore(context),
		creations: createCreationsStore(context),
		notifications: createNotificationsStore(context.client)
	};
}
