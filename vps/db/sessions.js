const SESSIONS_TABLE = "prsn_sessions";

export function createSessionsStore(client) {
	return {
		async create(userId, tokenHash, expiresAt) {
			const { error } = await client
				.from(SESSIONS_TABLE)
				.insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt });
			if (error) throw error;
		},

		async byToken(tokenHash, userId) {
			const { data, error } = await client
				.from(SESSIONS_TABLE)
				.select("id, user_id, expires_at")
				.eq("token_hash", tokenHash)
				.eq("user_id", userId)
				.maybeSingle();
			if (error) throw error;
			return data || null;
		},

		async delete(tokenHash, userId) {
			const { error } = await client
				.from(SESSIONS_TABLE)
				.delete()
				.eq("token_hash", tokenHash)
				.eq("user_id", userId);
			if (error) throw error;
		}
	};
}
