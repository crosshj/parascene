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
