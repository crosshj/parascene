import path from "node:path";

const IMAGE_BUCKET = "prsn_created-images";
const THUMBNAIL_BUCKET = "prsn_created-images-thumbnails";
const CREATION_FIELDS = "id, user_id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, meta, unavailable_at";

// Keep the VPS image-list boundary self-contained. The deployment image contains
// only vps/, so it must not import from the legacy WWW/API tree.
function isHiddenInGroupMeta(meta) {
	if (!meta || typeof meta !== "object") return false;
	return [meta.hidden_in_group, meta.hidden_in_project].some((value) => {
		const id = Number(value);
		return Number.isFinite(id) && id > 0;
	});
}

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
		.select(CREATION_FIELDS)
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
		async byIdForViewer(userId, creationId, { isAdmin = false } = {}) {
			const id = Number(creationId);
			if (!Number.isInteger(id) || id <= 0) return null;
			const { data, error } = await client
				.from("prsn_created_images")
				.select(CREATION_FIELDS)
				.eq("id", id)
				.maybeSingle();
			if (error) throw error;
			if (!data) return null;
			const owner = Number(data.user_id) === Number(userId);
			const published = data.published === true || data.published === 1;
			const unavailable = data.unavailable_at != null && data.unavailable_at !== "";
			if ((!owner && !published && !isAdmin) || (unavailable && !isAdmin)) return null;
			return data;
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
		async canAccessMedia(userId, creationId, key, { isAdmin = false } = {}) {
			const id = Number(creationId);
			const safe = safeKey(key);
			if (!Number.isInteger(id) || id <= 0 || !safe) return false;
			const row = await this.byIdForViewer(userId, id, { isAdmin });
			return Boolean(row && creationMediaKeys(row).some((value) => safe === safeKey(value)));
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
		async mintAudioPlaybackUrl(objectId) {
			if (!/^o_[a-f0-9]{24}$/.test(String(objectId || ""))) throw new Error("Invalid audio object");
			const { data: server, error } = await client
				.from("prsn_servers")
				.select("server_url, auth_token, server_config")
				.eq("id", 6)
				.maybeSingle();
			if (error) throw error;
			let origin = "";
			try { origin = new URL(server?.server_url).origin; } catch { /* missing or invalid host */ }
			if (!origin) throw new Error("Audio host is not configured");
			const headers = { Accept: "application/json", "Content-Type": "application/json" };
			const extraHeaders = server?.server_config?.custom_headers;
			if (extraHeaders && typeof extraHeaders === "object") {
				for (const [key, value] of Object.entries(extraHeaders)) if (value != null) headers[key] = String(value);
			}
			if (typeof server.auth_token === "string" && server.auth_token.trim()) headers.Authorization = `Bearer ${server.auth_token.trim()}`;
			const response = await fetch(`${origin}/cdn/objects/${encodeURIComponent(objectId)}/links`, {
				method: "POST", headers, body: "{}", signal: AbortSignal.timeout(20_000)
			});
			if (!response.ok) throw new Error(`Audio host returned ${response.status}`);
			const payload = await response.json();
			const url = typeof payload?.url === "string" ? payload.url.trim() : "";
			if (!url) throw new Error("Audio host returned no playback URL");
			return url;
		},
		safeKey
	};
}

export function creationMediaKey(row) {
	let meta = row?.meta;
	if (typeof meta === "string") {
		try { meta = JSON.parse(meta); } catch { meta = null; }
	}
	if (!meta || typeof meta !== "object") meta = null;
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

export function creationAudioCdnId(row) {
	let meta = row?.meta;
	if (typeof meta === "string") {
		try { meta = JSON.parse(meta); } catch { meta = null; }
	}
	const cdnId = meta?.audio && typeof meta.audio === "object" ? String(meta.audio.cdn_id || "").trim() : "";
	return /^o_[a-f0-9]{24}$/.test(cdnId) ? cdnId : "";
}

function mediaKeyFromValue(value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	for (const marker of ["/api/images/created/", "/api/videos/created/", "/api/creations/media/"]) {
		const markerIndex = raw.indexOf(marker);
		if (markerIndex < 0) continue;
		const encoded = raw.slice(markerIndex + marker.length).split("?", 1)[0];
		try { return decodeURIComponent(encoded); } catch { return encoded; }
	}
	if (raw.startsWith("http://") || raw.startsWith("https://")) return "";
	return raw.replace(/^\/+/, "");
}

export function creationVideoMediaKey(row) {
	let meta = row?.meta;
	if (typeof meta === "string") {
		try { meta = JSON.parse(meta); } catch { meta = null; }
	}
	if (!meta || typeof meta !== "object") meta = null;
	const video = meta?.video && typeof meta.video === "object" ? meta.video : null;
	return mediaKeyFromValue(
		row?.video_url ||
		row?.video_path ||
		meta?.video_url ||
		video?.file_path ||
		video?.filePath ||
		video?.url
	);
}

export function creationMediaKeys(row) {
	const values = [creationMediaKey({ filename: row?.filename, file_path: row?.file_path }), creationVideoMediaKey(row)];
	let meta = row?.meta;
	if (typeof meta === "string") {
		try { meta = JSON.parse(meta); } catch { meta = null; }
	}
	const group = meta?.group && typeof meta.group === "object" ? meta.group : null;
	const sources = group?.kind === "group_creations"
		? group.source_creations
		: group?.kind === "group_v2"
			? (Array.isArray(group.items) ? group.items.map((item) => item?.view || {}) : [])
			: [];
	for (const source of Array.isArray(sources) ? sources : []) {
		values.push(creationMediaKey(source), creationVideoMediaKey(source));
	}
	return [...new Set(values.filter(Boolean))];
}
