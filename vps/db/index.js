import { createProfileFilesStore } from "./profileFiles.js";
import { createGenericFilesStore } from "./genericFiles.js";
import { createSessionsStore } from "./sessions.js";
import { createSupabaseContext } from "./supabase.js";
import { createUsersStore } from "./users.js";
import { createCreditsStore } from "./credits.js";
import { createCreationsStore } from "./creations.js";
import { createNotificationsStore } from "./notifications.js";

export function createDb() {
	const context = createSupabaseContext();

	return {
		users: createUsersStore(context.client),
		credits: createCreditsStore(context.client),
		sessions: createSessionsStore(context.client),
		profileFiles: createProfileFilesStore(context),
		genericFiles: createGenericFilesStore(context),
		creations: createCreationsStore(context),
		notifications: createNotificationsStore(context.client)
	};
}
