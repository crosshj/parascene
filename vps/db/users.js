const USERS_TABLE = "prsn_users";
const PROFILES_TABLE = "prsn_user_profiles";
const LOGIN_FIELDS = "id, email, password_hash, role, created_at, last_active_at, meta";
const PUBLIC_FIELDS = "id, email, role, created_at, last_active_at, meta";
const PROFILE_FIELDS = "user_id, user_name, display_name, about, socials, avatar_url, cover_image_url, badges, meta, created_at, updated_at";

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

		async profileStats(viewerId, targetId) {
			const [allCreations, publishedCreations, followers, follow] = await Promise.all([
				client.from("prsn_created_images").select("id", { count: "exact", head: true }).eq("user_id", targetId).is("unavailable_at", null),
				client.from("prsn_created_images").select("id", { count: "exact", head: true }).eq("user_id", targetId).eq("published", true).is("unavailable_at", null),
				client.from("prsn_user_follows").select("id", { count: "exact", head: true }).eq("following_id", targetId),
				Number(viewerId) === Number(targetId)
					? Promise.resolve({ data: null, error: null })
					: client.from("prsn_user_follows").select("id").eq("follower_id", viewerId).eq("following_id", targetId).maybeSingle()
			]);
			for (const result of [allCreations, publishedCreations, followers, follow]) if (result.error) throw result.error;
			return {
				creations_total: Number(allCreations.count) || 0,
				creations_published: Number(publishedCreations.count) || 0,
				likes_received: 0,
				followers_count: Number(followers.count) || 0,
				viewer_follows: Boolean(follow.data)
			};
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
