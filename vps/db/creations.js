import path from "node:path";
import { isHiddenInGroupMeta } from "../../api_routes/utils/groupV2.js";

const IMAGE_BUCKET = "prsn_created-images";
const THUMBNAIL_BUCKET = "prsn_created-images-thumbnails";

function safeKey(value) {
	const key = String(value || "").trim();
	if (!key || key.length > 1024 || key.startsWith("/") || key.includes("..") || key.includes("\\") || /[\0-\x1f\x7f]/.test(key)) return null;
	if (key.split("/").some((part) => !part || part === ".")) return null;
	return key;
}

function storageObjectUrl(supabaseUrl, bucket, key) {
	const encoded = [bucket, ...key.split("/")].map(encodeURIComponent).join("/");
	return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${encoded}`;
}

function fitKey(key) {
	const ext = path.extname(key);
	return ext ? `${key.slice(0, -ext.length)}_fit.jpg` : `${key}_fit.jpg`;
}

function pageQuery(client, userId, limit, offset, challengeOnly, viewerEnableNsfw) {
	let query = client
		.from("prsn_created_images")
		.select("id, user_id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, unavailable_at")
		.eq("user_id", userId)
		.is("unavailable_at", null)
		.is("meta->>hidden_in_group", null)
		.is("meta->>hidden_in_project", null)
		.order("created_at", { ascending: false });
	if (challengeOnly) query = query.not("meta->>challenge_submissions", "is", null).neq("meta->>challenge_submissions", "[]");
	if (!viewerEnableNsfw) query = query.or("meta->>nsfw.is.null,meta->>nsfw.eq.false");
	return query.range(offset, offset + limit);
}

export function createCreationsStore({ client, supabaseUrl, serviceRoleKey }) {
	return {
		async list(userId, { limit = 50, offset = 0, challengeOnly = false, viewerEnableNsfw = false } = {}) {
			const { data, error } = await pageQuery(client, userId, limit, offset, challengeOnly, viewerEnableNsfw);
			if (error) throw error;
			const rows = (Array.isArray(data) ? data : []).filter((row) => !isHiddenInGroupMeta(row?.meta));
			return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
		},
		async owns(userId, creationId) {
			const id = Number(creationId);
			if (!Number.isInteger(id) || id <= 0) return false;
			const { data, error } = await client
				.from("prsn_created_images")
				.select("id")
				.eq("id", id)
				.eq("user_id", userId)
				.maybeSingle();
			if (error) throw error;
			return Boolean(data);
		},
		async ownsMedia(userId, creationId, key) {
			const id = Number(creationId);
			const safe = safeKey(key);
			if (!Number.isInteger(id) || id <= 0 || !safe) return false;
			const { data, error } = await client
				.from("prsn_created_images")
				.select("filename, file_path, meta")
				.eq("id", id)
				.eq("user_id", userId)
				.maybeSingle();
			if (error) throw error;
			if (!data) return false;
			return creationMediaKeys(data).some((value) => safe === safeKey(value));
		},

		async fetchMedia(filename, { variant = "", method = "GET", range, signal } = {}) {
			const key = safeKey(filename);
			if (!key) return new Response(null, { status: 404 });
			const normalizedVariant = String(variant || "").trim().toLowerCase();
			const bucket = normalizedVariant === "thumbnail" || normalizedVariant === "fit" ? THUMBNAIL_BUCKET : IMAGE_BUCKET;
			const objectKey = normalizedVariant === "fit" ? fitKey(key) : key;
			const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
			if (range) headers.Range = range;
			let response = await fetch(storageObjectUrl(supabaseUrl, bucket, objectKey), { method, headers, signal, redirect: "manual" });
			if (!response.ok && normalizedVariant === "fit") {
				response = await fetch(storageObjectUrl(supabaseUrl, THUMBNAIL_BUCKET, key), { method, headers, signal, redirect: "manual" });
			}
			// WWW treats derivative thumbnails as optional. A missing derivative must not
			// turn a valid creation into a blank tile, especially for older media.
			if (!response.ok && (normalizedVariant === "thumbnail" || normalizedVariant === "fit")) {
				response = await fetch(storageObjectUrl(supabaseUrl, IMAGE_BUCKET, key), { method, headers, signal, redirect: "manual" });
			}
			return response;
		},
		safeKey
	};
}

export function creationMediaKey(row) {
	const meta = row?.meta && typeof row.meta === "object" ? row.meta : null;
	const group = meta?.group && typeof meta.group === "object" ? meta.group : null;
	if (group?.kind === "group_v2") {
		const cover = (Array.isArray(group.items) ? group.items : []).find((item) => item?.cover) || group.items?.[0];
		const view = cover?.view && typeof cover.view === "object" ? cover.view : null;
		const coverPath = view?.filePath || view?.file_path || view?.url || view?.filename;
		if (coverPath) return creationMediaKey({ file_path: coverPath, filename: view?.filename });
	}
	if (group?.kind === "group_creations") {
		const sources = Array.isArray(group.source_creations) ? group.source_creations : [];
		const coverId = Number(group.cover_source_id);
		const cover = sources.find((source) => Number(source?.id) === coverId) || sources[0];
		if (cover) return creationMediaKey(cover);
	}
	const filePath = String(row?.file_path || "").trim();
	const marker = "/api/images/created/";
	const markerIndex = filePath.indexOf(marker);
	if (markerIndex >= 0) {
		const encoded = filePath.slice(markerIndex + marker.length).split("?", 1)[0];
		try { return decodeURIComponent(encoded); } catch { return encoded; }
	}
	if (filePath && !filePath.startsWith("http://") && !filePath.startsWith("https://")) return filePath.replace(/^\/+/, "");
	return String(row?.filename || "").trim();
}

export function creationMediaKeys(row) {
	const values = [creationMediaKey({ filename: row?.filename, file_path: row?.file_path })];
	const group = row?.meta?.group && typeof row.meta.group === "object" ? row.meta.group : null;
	const sources = group?.kind === "group_creations"
		? group.source_creations
		: group?.kind === "group_v2"
			? (Array.isArray(group.items) ? group.items.map((item) => item?.view || {}) : [])
			: [];
	for (const source of Array.isArray(sources) ? sources : []) values.push(creationMediaKey(source));
	return [...new Set(values.filter(Boolean))];
}
