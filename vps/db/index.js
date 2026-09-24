import { createProfileFilesStore } from "./profileFiles.js";
import { createSessionsStore } from "./sessions.js";
import { createSupabaseContext } from "./supabase.js";
import { createUsersStore } from "./users.js";

export function createDb() {
	const context = createSupabaseContext();

	return {
		users: createUsersStore(context.client),
		sessions: createSessionsStore(context.client),
		profileFiles: createProfileFilesStore(context)
	};
}
