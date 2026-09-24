const USERS_TABLE = "prsn_users";
const PROFILES_TABLE = "prsn_user_profiles";
const LOGIN_FIELDS = "id, email, password_hash, role, created_at, last_active_at, meta";
const PUBLIC_FIELDS = "id, email, role, created_at, last_active_at, meta";
const PROFILE_FIELDS = "user_id, user_name, display_name, avatar_url";

export function createUsersStore(client) {
	async function byIdForLogin(id) {
		const { data, error } = await client
			.from(USERS_TABLE)
			.select(LOGIN_FIELDS)
			.eq("id", id)
			.maybeSingle();
		if (error) throw error;
		return data || null;
	}

	return {
		async byEmail(email) {
			const { data, error } = await client
				.from(USERS_TABLE)
				.select(LOGIN_FIELDS)
				.ilike("email", email)
				.maybeSingle();
			if (error) throw error;
			return data || null;
		},

		async byUsername(username) {
			const { data: profile, error } = await client
				.from(PROFILES_TABLE)
				.select("user_id")
				.ilike("user_name", username)
				.maybeSingle();
			if (error) throw error;
			return profile?.user_id ? byIdForLogin(profile.user_id) : null;
		},

		byIdForLogin,

		async byId(id) {
			const { data, error } = await client
				.from(USERS_TABLE)
				.select(PUBLIC_FIELDS)
				.eq("id", id)
				.maybeSingle();
			if (error) throw error;
			return data || null;
		},

		async profileByUserId(id) {
			const { data, error } = await client
				.from(PROFILES_TABLE)
				.select(PROFILE_FIELDS)
				.eq("user_id", id)
				.maybeSingle();
			if (error) throw error;
			return data || null;
		},

		async create(email, passwordHash) {
			const { data, error } = await client
				.from(USERS_TABLE)
				.insert({ email, password_hash: passwordHash, role: "consumer" })
				.select("id")
				.single();
			if (error) throw error;
			return data.id;
		}
	};
}
