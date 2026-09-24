import { createClient } from "@supabase/supabase-js";

function required(name) {
	const value = String(process.env[name] || "").trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
}

export function createSupabaseContext() {
	const supabaseUrl = required("SUPABASE_URL");
	const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
	const client = createClient(supabaseUrl, serviceRoleKey, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
			detectSessionInUrl: false
		}
	});

	return { client, supabaseUrl, serviceRoleKey };
}
