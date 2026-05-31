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
