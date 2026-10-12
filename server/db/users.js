const USERS_TABLE = "prsn_users";
const PROFILES_TABLE = "prsn_user_profiles";
const LOGIN_FIELDS = "id, email, password_hash, role, created_at, last_active_at, meta";
const PUBLIC_FIELDS = "id, email, role, created_at, last_active_at, meta";
const PROFILE_FIELDS = "user_id, user_name, display_name, about, socials, avatar_url, cover_image_url, badges, meta, created_at, updated_at";
const CACHE_TTL_MS = 60 * 60 * 1000;

export function createUsersStore(client) {
	const bootstrapCache = new Map();
	function cachePart(id, key, value) {
		const userId = Number(id);
		if (!Number.isInteger(userId) || userId <= 0) return;
		const entry = bootstrapCache.get(userId) || { user: null, profile: null, userLoaded: false, profileLoaded: false, userAt: 0, profileAt: 0 };
		entry[key] = value;
		entry[`${key}Loaded`] = true;
		entry[`${key}At`] = Date.now();
		bootstrapCache.set(userId, entry);
	}
	function invalidateCache(id) {
		bootstrapCache.delete(Number(id));
	}
	function getCachedBootstrap(id) {
		const userId = Number(id);
		const entry = bootstrapCache.get(userId);
		if (!entry) return null;
		const now = Date.now();
		if ((entry.userLoaded && now - entry.userAt > CACHE_TTL_MS) || (entry.profileLoaded && now - entry.profileAt > CACHE_TTL_MS)) {
			bootstrapCache.delete(userId);
			return null;
		}
		if (!entry.userLoaded || !entry.profileLoaded) return null;
		return { user: entry.user, profile: entry.profile };
	}

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
			const user = data || null;
			if (user) cachePart(id, "user", user);
			else invalidateCache(id);
			return user;
		},

		async profileByUserId(id) {
			const { data, error } = await client
				.from(PROFILES_TABLE)
				.select(PROFILE_FIELDS)
				.eq("user_id", id)
				.maybeSingle();
			if (error) throw error;
			const profile = data || null;
			cachePart(id, "profile", profile);
			return profile;
		},

		getCachedBootstrap,
		invalidateCache,

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
