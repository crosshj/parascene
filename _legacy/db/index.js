import { openDb as openSupabaseDb } from "./supabase.js";

function shouldLogDbOpen() {
	return process.env.ENABLE_DB_LOGS === "true";
}

async function openDb(options = {}) {
	const { quiet = false } = options;
	const log = quiet || !shouldLogDbOpen() ? () => {} : console.log;
	log("Database connected.");
	return openSupabaseDb();
}

export { openDb };
