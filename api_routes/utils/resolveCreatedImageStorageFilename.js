export function parseCreationMeta(raw) {
	if (raw == null) return null;
	if (typeof raw === "object") return raw;
	if (typeof raw !== "string") return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/** Extract storage key from /api/images/created/{filename} (may include subpaths). */
export function extractFilenameFromCreatedImagePath(filePath) {
	const fp = typeof filePath === "string" ? filePath.trim() : "";
	if (!fp) return null;
	const marker = "/api/images/created/";
	const idx = fp.indexOf(marker);
	if (idx < 0) return null;
	const rest = fp.slice(idx + marker.length);
	const pathOnly = rest.split("?")[0].split("#")[0].trim();
	if (!pathOnly || pathOnly.includes("..")) return null;
	try {
		return decodeURIComponent(pathOnly);
	} catch {
		return pathOnly;
	}
}

/**
 * Group creations store a synthetic group/{id}_... filename that is not uploaded.
 * Use the cover source file (from meta) for storage reads and share/export.
 */
/**
 * Parse creation id embedded in standard storage keys: `{userId}_{imageId}_{ts}_{rand}.ext`
 * or `anon_{imageId}_{ts}_{rand}.ext`.
 * @param {string|null|undefined} filename
 * @returns {number|null}
 */
export function parseCreationImageIdFromStorageFilename(filename) {
	const fp = typeof filename === "string" ? filename.trim() : "";
	if (!fp || fp.startsWith("landscape/")) return null;
	const baseName = (fp.split("/").pop() || "").replace(/\.[^.]+$/, "");
	if (!baseName) return null;
	const parts = baseName.split("_");
	if (baseName.startsWith("anon_")) {
		const id = Number(parts[1]);
		return Number.isFinite(id) && id > 0 ? id : null;
	}
	const id = Number(parts[1]);
	return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Creation id from a Parascene hosted video URL.
 * Prefers `?creation_id=`; else `{userId}_{imageId}_…` in `/api/videos/created/video/…`.
 * @param {string|null|undefined} raw
 * @param {string} [baseOrigin]
 * @returns {number|null}
 */
/**
 * Filename + creation_id from a Parascene hosted still URL.
 * `creation_id` is the reliable key — some uploads are `{userId}_{ts}_{rand}.png`.
 * @param {string|null|undefined} raw
 * @param {string} [baseOrigin]
 * @returns {{ filename: string, creationId: number|null }|null}
 */
export function parseParasceneCreatedImageUrl(raw, baseOrigin = "https://www.parascene.com") {
	const s = typeof raw === "string" ? raw.trim() : "";
	if (!s) return null;
	if (!s.includes("/api/images/created/") && !s.includes("/images/created/")) return null;
	try {
		const u = new URL(s, baseOrigin);
		const path = u.pathname || "";
		let filename = extractFilenameFromCreatedImagePath(`${path}`);
		if (!filename) {
			const legacy = "/images/created/";
			const idx = path.indexOf(legacy);
			if (idx >= 0) {
				const rest = path.slice(idx + legacy.length);
				if (rest && !rest.includes("..")) {
					try {
						filename = decodeURIComponent(rest);
					} catch {
						filename = rest;
					}
				}
			}
		}
		if (!filename) return null;
		const qid = Number(u.searchParams.get("creation_id"));
		return {
			filename,
			creationId: Number.isFinite(qid) && qid > 0 ? qid : null,
		};
	} catch {
		return null;
	}
}

/**
 * Provider rewrite lookup: `creation_id` first (desktop stamps it), then filename / embedded id.
 * @param {{ queries: { selectCreatedImageByFilename?: { get: (filename: string) => Promise<object|undefined> }, selectCreatedImageByIdAnyUser?: { get: (id: number) => Promise<object|undefined> } }, url: string, baseOrigin?: string }} params
 */
export async function resolveCreatedImageRowForProviderImageUrl({
	queries,
	url,
	baseOrigin = "https://www.parascene.com",
}) {
	const parsed = parseParasceneCreatedImageUrl(url, baseOrigin);
	if (!parsed) return null;
	if (parsed.creationId) {
		const byId = await queries.selectCreatedImageByIdAnyUser?.get(parsed.creationId);
		if (byId) return byId;
	}
	return resolveCreatedImageRowForCreatedMediaPath({
		queries,
		filename: parsed.filename,
		query: parsed.creationId ? { creation_id: parsed.creationId } : null,
	});
}

export function creationIdFromParasceneVideoUrl(raw, baseOrigin = "https://www.parascene.com") {
	const s = typeof raw === "string" ? raw.trim() : "";
	if (!s) return null;
	if (!s.includes("/api/videos/created/") && !s.includes("/videos/created/")) return null;
	try {
		const u = new URL(s, baseOrigin);
		const qid = Number(u.searchParams.get("creation_id"));
		if (Number.isFinite(qid) && qid > 0) return qid;
		const path = u.pathname || "";
		const marker = "/api/videos/created/";
		const idx = path.indexOf(marker);
		const rest = idx >= 0 ? path.slice(idx + marker.length) : path.replace(/^\/+/, "");
		return parseCreationImageIdFromStorageFilename(rest);
	} catch {
		return null;
	}
}

/**
 * Resolve a created_images row for GET /api/images/created/* (incl. stale poster paths).
 * @param {{ queries: { selectCreatedImageByFilename?: { get: (filename: string) => Promise<object|undefined> }, selectCreatedImageByIdAnyUser?: { get: (id: number) => Promise<object|undefined> } }, filename: string, query?: Record<string, unknown>|null }} params
 * @returns {Promise<object|null|undefined>}
 */
export async function resolveCreatedImageRowForCreatedMediaPath({ queries, filename, query = null }) {
	const fp = typeof filename === "string" ? filename.trim() : "";
	if (!fp) return null;

	if (fp.startsWith("landscape/")) {
		const imageId = parseCreationImageIdFromStorageFilename(fp.slice("landscape/".length));
		if (!imageId) return null;
		return (await queries.selectCreatedImageByIdAnyUser?.get(imageId)) ?? null;
	}

	let image = await queries.selectCreatedImageByFilename?.get(fp);
	if (image) return image;

	const q = query && typeof query === "object" ? query : {};
	const delegatedRaw = q.creation_id ?? q.group_id ?? q.group_of;
	const delegatedId = typeof delegatedRaw === "string" ? parseInt(delegatedRaw, 10) : Number(delegatedRaw);
	if (Number.isFinite(delegatedId) && delegatedId > 0) {
		image = await queries.selectCreatedImageByIdAnyUser?.get(delegatedId);
		if (image) return image;
	}

	const imageId = parseCreationImageIdFromStorageFilename(fp);
	if (imageId) {
		return (await queries.selectCreatedImageByIdAnyUser?.get(imageId)) ?? null;
	}

	return null;
}

export function resolveCreatedImageStorageFilename(image) {
	const primary = typeof image?.filename === "string" ? image.filename.trim() : "";
	const meta = parseCreationMeta(image?.meta);
	const groupPayload = meta?.group && typeof meta.group === "object" ? meta.group : null;
	if (groupPayload?.kind !== "group_creations") {
		return primary || null;
	}

	const sourcesRaw = Array.isArray(groupPayload.source_creations) ? groupPayload.source_creations : [];
	const coverId = Number(groupPayload.cover_source_id);
	let coverSource = null;
	if (Number.isFinite(coverId) && coverId > 0) {
		coverSource = sourcesRaw.find((s) => s && typeof s === "object" && Number(s.id) === coverId) || null;
	}
	if (!coverSource) {
		coverSource = sourcesRaw.find((s) => s && typeof s === "object") || null;
	}

	if (coverSource) {
		const sourceFilename = typeof coverSource.filename === "string" ? coverSource.filename.trim() : "";
		if (sourceFilename && !sourceFilename.startsWith("group/")) {
			return sourceFilename;
		}
		const fromSourcePath = extractFilenameFromCreatedImagePath(coverSource.file_path);
		if (fromSourcePath) return fromSourcePath;
	}

	const fromRowPath = extractFilenameFromCreatedImagePath(image?.file_path);
	if (fromRowPath) return fromRowPath;

	return primary && !primary.startsWith("group/") ? primary : null;
}
