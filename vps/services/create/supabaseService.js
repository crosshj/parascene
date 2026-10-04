import { createClient } from "@supabase/supabase-js";

let supabaseServiceClient = null;

/**
 * Get Supabase client with service role (for server-only operations like embeddings RPC).
 * @returns {import("@supabase/supabase-js").SupabaseClient | null}
 */
export function getSupabaseServiceClient() {
	if (supabaseServiceClient) return supabaseServiceClient;
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) return null;
	supabaseServiceClient = createClient(url, key);
	return supabaseServiceClient;
}
