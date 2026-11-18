import { costumeGroupV2Meta } from "../services/create/groupV2.js";
import { isNewUserCreation } from "../../shared/newUserCreation.js";

const CREATION_FIELDS = "id, user_id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, unavailable_at";
const TYPES = new Set(["image", "video", "audio"]);
const NEW_USER_PAGE = 40;
const NEW_USER_PAGES = 4;

function parseMeta(value) {
	if (value && typeof value === "object" && !Array.isArray(value)) return value;
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
		} catch {
			return {};
		}
	}
	return {};
}

function hiddenInGroup(meta) {
	return [meta.hidden_in_group, meta.hidden_in_project].some((value) => {
		const id = Number(value);
		return Number.isFinite(id) && id > 0;
	});
}

// Group v2 stores each member's type on the cover, not always on the row.
export function homeLatestMediaType(row) {
	const meta = parseMeta(row?.meta);
	if (meta.group?.kind === "group_v2") {
		const type = String(costumeGroupV2Meta(meta, { title: row?.title }).media_type || "").trim().toLowerCase();
		if (type === "video" || type === "audio") return type;
		return "image";
	}
	const type = String(meta.media_type || "").trim().toLowerCase();
	if (type === "video" || type === "audio") return type;
	return "image";
}

async function userNames(client, rows) {
	const ids = [...new Set(rows.map((row) => Number(row?.user_id)).filter((id) => Number.isInteger(id) && id > 0))];
	if (!ids.length) return new Map();
	const result = await client.from("prsn_user_profiles").select("user_id, user_name").in("user_id", ids);
	if (result.error) throw result.error;
	const names = new Map();
	for (const profile of result.data || []) {
		const id = Number(profile?.user_id);
		const name = String(profile?.user_name || "").trim();
		if (Number.isInteger(id) && id > 0 && name) names.set(id, name);
	}
	return names;
}

function publishedAt(row) {
	const time = new Date(row?.published_at || 0).getTime();
	return Number.isFinite(time) ? time : 0;
}

function baseQuery(client, viewerEnableNsfw) {
	let query = client
		.from("prsn_created_images")
		.select(CREATION_FIELDS)
		.eq("published", true)
		.not("published_at", "is", null)
		.is("unavailable_at", null)
		.is("meta->>hidden_in_group", null)
		.is("meta->>hidden_in_project", null);
	if (!viewerEnableNsfw) query = query.or("meta->>nsfw.is.null,meta->>nsfw.eq.false");
	return query.order("published_at", { ascending: false }).order("id", { ascending: false });
}

export function createHomeLatestStore(client) {
	return {
		async latestPublished(type, { limit = 12, viewerEnableNsfw = false } = {}) {
			const kind = TYPES.has(type) ? type : "image";
			const safeLimit = Math.min(24, Math.max(1, Number(limit) || 12));
			const fetchLimit = kind === "image" ? Math.min(48, safeLimit * 3) : safeLimit;
			const typed = baseQuery(client, viewerEnableNsfw);
			const typedQuery = kind === "image"
				? typed
					.or("meta->>media_type.is.null,meta->>media_type.eq.image")
					.or("meta->group->>kind.is.null,meta->group->>kind.neq.group_v2")
				: typed.eq("meta->>media_type", kind);
			const groupedQuery = baseQuery(client, viewerEnableNsfw)
				.eq("meta->group->>kind", "group_v2")
				.limit(Math.min(24, safeLimit * 3));
			const [typedResult, groupedResult] = await Promise.all([
				typedQuery.limit(fetchLimit),
				groupedQuery
			]);
			if (typedResult.error) throw typedResult.error;
			if (groupedResult.error) throw groupedResult.error;
			const byId = new Map();
			for (const row of [...(typedResult.data || []), ...(groupedResult.data || [])]) {
				const id = Number(row?.id);
				if (!Number.isInteger(id) || id <= 0 || hiddenInGroup(parseMeta(row?.meta))) continue;
				if (kind === "image" && isNewUserCreation(row)) continue;
				if (homeLatestMediaType(row) !== kind) continue;
				byId.set(id, row);
			}
			return [...byId.values()]
				.sort((a, b) => publishedAt(b) - publishedAt(a) || Number(b.id) - Number(a.id))
				.slice(0, safeLimit);
		},
		async latestNewUsers({ limit = 12, viewerEnableNsfw = false } = {}) {
			const safeLimit = Math.min(24, Math.max(1, Number(limit) || 12));
			const chosen = [];
			for (let page = 0; page < NEW_USER_PAGES && chosen.length < safeLimit; page += 1) {
				const start = page * NEW_USER_PAGE;
				const usersResult = await client.from("prsn_users")
					.select("id, created_at")
					.order("created_at", { ascending: false })
					.order("id", { ascending: false })
					.range(start, start + NEW_USER_PAGE - 1);
				if (usersResult.error) throw usersResult.error;
				const users = Array.isArray(usersResult.data) ? usersResult.data : [];
				const ids = users.map((user) => Number(user?.id)).filter((id) => Number.isInteger(id) && id > 0);
				if (!ids.length) break;
				let creationsQuery = client.from("prsn_created_images")
					.select(CREATION_FIELDS)
					.in("user_id", ids)
					.eq("published", true)
					.not("published_at", "is", null)
					.is("unavailable_at", null)
					.is("meta->>hidden_in_group", null)
					.is("meta->>hidden_in_project", null);
				if (!viewerEnableNsfw) creationsQuery = creationsQuery.or("meta->>nsfw.is.null,meta->>nsfw.eq.false");
				const creationsResult = await creationsQuery;
				if (creationsResult.error) throw creationsResult.error;
				const introByUser = new Map();
				for (const row of creationsResult.data || []) {
					const userId = Number(row?.user_id);
					if (!Number.isInteger(userId) || userId <= 0 || hiddenInGroup(parseMeta(row?.meta))) continue;
					if (!isNewUserCreation(row)) continue;
					const current = introByUser.get(userId);
					if (!current || publishedAt(row) < publishedAt(current)) introByUser.set(userId, row);
				}
				for (const user of users) {
					const row = introByUser.get(Number(user?.id));
					if (!row) continue;
					chosen.push(row);
					if (chosen.length >= safeLimit) break;
				}
				if (users.length < NEW_USER_PAGE) break;
			}
			const names = await userNames(client, chosen);
			return chosen.map((row) => ({ ...row, user_name: names.get(Number(row.user_id)) || "" }));
		}
	};
}
