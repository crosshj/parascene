export const LIBRARY_FOLDER_TITLE_MAX = 200;
export const LIBRARY_FOLDER_DESCRIPTION_MAX = 2000;
export const LIBRARY_FOLDER_OPS_MAX = 100;
export const LIBRARY_FOLDER_CREATION_IDS_MAX = 500;
export const LIBRARY_FOLDER_COUNT_MAX = 500;
export const LIBRARY_FOLDER_META_MAX_BYTES = 16 * 1024;

const PROJECT_META_NAMESPACE = "parascene_desktop";
const PROJECT_META_ID = "project_id";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
	return typeof value === "string" && UUID_RE.test(value.trim());
}

export function normalizeFolderTitle(raw) {
	const title = typeof raw === "string" ? raw.trim() : "";
	return title || "Untitled folder";
}

function normalizeMeta(raw) {
	if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
		return { error: "meta must be an object" };
	}
	let encoded;
	try {
		encoded = JSON.stringify(raw);
	} catch {
		return { error: "meta must be valid JSON" };
	}
	if (Buffer.byteLength(encoded, "utf8") > LIBRARY_FOLDER_META_MAX_BYTES) {
		return { error: "meta too large" };
	}
	return { meta: JSON.parse(encoded) };
}

export function projectIdFromFolderMeta(meta) {
	const projectId = meta?.[PROJECT_META_NAMESPACE]?.[PROJECT_META_ID];
	return isUuid(projectId) ? projectId.trim().toLowerCase() : null;
}

function readProjectId(raw) {
	const value = raw?.project_id ?? raw?.projectId;
	if (value == null || value === "") return { projectId: null };
	if (!isUuid(value)) return { error: "project_id must be a uuid" };
	return { projectId: value.trim().toLowerCase() };
}

function readCreationIds(op) {
	const raw = op?.creation_ids ?? op?.creationIds;
	if (raw == null) return null;
	if (!Array.isArray(raw)) {
		return { error: "creation_ids must be an array" };
	}
	if (raw.length > LIBRARY_FOLDER_CREATION_IDS_MAX) {
		return { error: "too many creation_ids" };
	}
	const ids = [];
	const seen = new Set();
	for (const item of raw) {
		const n = Number(item);
		if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
			return { error: "creation_ids must be positive integers" };
		}
		if (seen.has(n)) continue;
		seen.add(n);
		ids.push(n);
	}
	return { ids };
}

/**
 * Validate and normalize mutate operations for API + RPC.
 * @returns {{ operations: object[] } | { error: string }}
 */
export function normalizeLibraryFolderOperations(rawOperations) {
	if (!Array.isArray(rawOperations)) {
		return { error: "operations must be an array" };
	}
	if (rawOperations.length < 1) {
		return { error: "operations must not be empty" };
	}
	if (rawOperations.length > LIBRARY_FOLDER_OPS_MAX) {
		return { error: "too many operations" };
	}

	const operations = [];
	for (const raw of rawOperations) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			return { error: "operation must be an object" };
		}
		const opType = String(raw.op ?? raw.type ?? "")
			.trim()
			.toLowerCase();
		if (!opType) {
			return { error: "operation.op is required" };
		}

		if (opType === "create") {
			const id = typeof raw.id === "string" ? raw.id.trim() : "";
			if (!isUuid(id)) {
				return { error: "create.id must be a uuid" };
			}
			const title = normalizeFolderTitle(raw.title);
			if (title.length > LIBRARY_FOLDER_TITLE_MAX) {
				return { error: "title too long" };
			}
			const description = raw.description == null ? "" : String(raw.description);
			if (description.length > LIBRARY_FOLDER_DESCRIPTION_MAX) {
				return { error: "description too long" };
			}
			const op = { op: "create", id, title, description };
			if (Object.prototype.hasOwnProperty.call(raw, "meta")) {
				const parsed = normalizeMeta(raw.meta);
				if (parsed.error) return { error: parsed.error };
				op.meta = parsed.meta;
			}
			const project = readProjectId(raw);
			if (project.error) return { error: project.error };
			if (project.projectId) op.project_id = project.projectId;
			const markerProjectId = projectIdFromFolderMeta(op.meta);
			if (markerProjectId && markerProjectId !== project.projectId) {
				return { error: "project_id must match the project folder marker" };
			}
			if (raw.creation_ids != null || raw.creationIds != null) {
				const parsed = readCreationIds(raw);
				if (parsed.error) return { error: parsed.error };
				op.creation_ids = parsed.ids;
			}
			operations.push(op);
			continue;
		}

		if (opType === "update") {
			const id = typeof raw.id === "string" ? raw.id.trim() : "";
			if (!isUuid(id)) {
				return { error: "update.id must be a uuid" };
			}
			const op = { op: "update", id };
			if (Object.prototype.hasOwnProperty.call(raw, "title")) {
				const title = normalizeFolderTitle(raw.title);
				if (title.length > LIBRARY_FOLDER_TITLE_MAX) {
					return { error: "title too long" };
				}
				op.title = title;
			}
			if (Object.prototype.hasOwnProperty.call(raw, "description")) {
				const description = raw.description == null ? "" : String(raw.description);
				if (description.length > LIBRARY_FOLDER_DESCRIPTION_MAX) {
					return { error: "description too long" };
				}
				op.description = description;
			}
			if (Object.prototype.hasOwnProperty.call(raw, "meta")) {
				const parsed = normalizeMeta(raw.meta);
				if (parsed.error) return { error: parsed.error };
				op.meta = parsed.meta;
			}
			const project = readProjectId(raw);
			if (project.error) return { error: project.error };
			if (project.projectId) op.project_id = project.projectId;
			const markerProjectId = projectIdFromFolderMeta(op.meta);
			if (markerProjectId && markerProjectId !== project.projectId) {
				return { error: "project_id must match the project folder marker" };
			}
			if (op.title === undefined && op.description === undefined && op.meta === undefined) {
				return { error: "update requires title, description, and/or meta" };
			}
			operations.push(op);
			continue;
		}

		if (opType === "delete") {
			const id = typeof raw.id === "string" ? raw.id.trim() : "";
			if (!isUuid(id)) {
				return { error: "delete.id must be a uuid" };
			}
			const project = readProjectId(raw);
			if (project.error) return { error: project.error };
			const op = { op: "delete", id };
			if (project.projectId) op.project_id = project.projectId;
			operations.push(op);
			continue;
		}

		if (opType === "move") {
			const hasFolderId =
				Object.prototype.hasOwnProperty.call(raw, "folder_id") ||
				Object.prototype.hasOwnProperty.call(raw, "folderId");
			if (!hasFolderId) {
				return { error: "move.folder_id is required (uuid or null)" };
			}
			const folderRaw = raw.folder_id !== undefined ? raw.folder_id : raw.folderId;
			let folderId = null;
			if (folderRaw != null) {
				const id = typeof folderRaw === "string" ? folderRaw.trim() : "";
				if (!isUuid(id)) {
					return { error: "move.folder_id must be a uuid or null" };
				}
				folderId = id;
			}
			const parsed = readCreationIds(raw);
			if (parsed.error) return { error: parsed.error };
			if (!parsed.ids || parsed.ids.length < 1) {
				return { error: "move.creation_ids required" };
			}
			const project = readProjectId(raw);
			if (project.error) return { error: project.error };
			const op = {
				op: "move",
				folder_id: folderId,
				creation_ids: parsed.ids
			};
			if (project.projectId) op.project_id = project.projectId;
			operations.push(op);
			continue;
		}

		return { error: "unknown operation" };
	}

	return { operations };
}

export function parseBaseRevision(raw) {
	if (raw == null || raw === "") return { error: "base_revision is required" };
	const n = Number(raw);
	if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
		return { error: "invalid base_revision" };
	}
	return { revision: n };
}

export function formatLibraryFoldersSnapshot(snapshot) {
	const revision = Number(snapshot?.revision) || 0;
	const folders = Array.isArray(snapshot?.folders) ? snapshot.folders : [];
	return {
		revision,
		folders: folders.map((folder) => ({
			id: String(folder.id),
			title: typeof folder.title === "string" ? folder.title : "",
			description: typeof folder.description === "string" ? folder.description : "",
			meta:
				folder.meta && typeof folder.meta === "object" && !Array.isArray(folder.meta)
					? folder.meta
					: {},
			created_at: folder.created_at ?? null,
			updated_at: folder.updated_at ?? null,
			creation_ids: Array.isArray(folder.creation_ids)
				? folder.creation_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
				: [],
			member_count: Array.isArray(folder.creation_ids) ? folder.creation_ids.length : 0
		}))
	};
}
