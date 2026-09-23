import { createClient } from "@supabase/supabase-js";

function required(name) { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`${name} is required`); return value; }

export function createDb() {
	const client = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
	const table = (name) => `prsn_${name}`;
	return {
		async userByEmail(email) { const { data, error } = await client.from(table("users")).select("id, email, password_hash, role, created_at, last_active_at, meta").eq("email", email).maybeSingle(); if (error) throw error; return data || null; },
		async userById(id) { const { data, error } = await client.from(table("users")).select("id, email, role, created_at, last_active_at, meta").eq("id", id).maybeSingle(); if (error) throw error; return data || null; },
		async profileByUserId(id) { const { data, error } = await client.from(table("user_profiles")).select("user_id, user_name, display_name, avatar_url").eq("user_id", id).maybeSingle(); if (error) throw error; return data || null; },
		async createUser(email, passwordHash) { const { data, error } = await client.from(table("users")).insert({ email, password_hash: passwordHash, role: "consumer" }).select("id").single(); if (error) throw error; return data.id; },
		async createSession(userId, tokenHash, expiresAt) { const { error } = await client.from(table("sessions")).insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt }); if (error) throw error; },
		async sessionByToken(tokenHash, userId) { const { data, error } = await client.from(table("sessions")).select("id, user_id, expires_at").eq("token_hash", tokenHash).eq("user_id", userId).maybeSingle(); if (error) throw error; return data || null; },
		async deleteSession(tokenHash, userId) { const { error } = await client.from(table("sessions")).delete().eq("token_hash", tokenHash).eq("user_id", userId); if (error) throw error; }
	};
}
