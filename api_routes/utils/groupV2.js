/** Generic group v2 list: 1-to-1 view+pointer rows. Not a project API. */

export const GROUP_V2_KIND = "group_v2";
export const HIDDEN_IN_GROUP_META_KEY = "hidden_in_group";
/** Read-only alias for rows written before the generic hide key. */
export const HIDDEN_IN_PROJECT_META_KEY = "hidden_in_project";
export const DESKTOP_HEADER = "x-parascene-desktop";

const LOCAL_POINTER_RE = /^local:\/\/([^/]+)\/(.+)$/;

export function nowIso() {
	return new Date().toISOString();
}

export function wantsRawGroupV2(req) {
	if (!req) return false;
	const header = String(req.get?.(DESKTOP_HEADER) || req.headers?.[DESKTOP_HEADER] || "").trim();
	if (header === "1" || header.toLowerCase() === "true") return true;
	const q = req.query || {};
	if (q.desktop === "1" || q.desktop === "true") return true;
	if (q.raw === "1" || q.raw === "true") return true;
	if (q.costume === "0" || q.costume === "false") return true;
	return false;
}

export function parseMeta(raw) {
	if (!raw) return {};
	if (typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
	if (typeof raw !== "string") return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

export function isGroupV2Meta(meta) {
	const kind = String(meta?.group?.kind || "").trim();
	return kind === GROUP_V2_KIND;
}

export function isGroupV2Row(row) {
	return isGroupV2Meta(parseMeta(row?.meta));
}

export function emptyGroupV2Meta(opts = {}) {
	const createdAt = typeof opts.createdAt === "string" && opts.createdAt ? opts.createdAt : nowIso();
	const items = normalizeItems(opts.items);
	return {
		group: {
			kind: GROUP_V2_KIND,
			version: 2,
			created_at: createdAt,
			updated_at: createdAt,
			items,
		},
	};
}

export function groupV2Items(meta) {
	const m = meta && typeof meta === "object" ? meta : {};
	return normalizeItems(m.group?.items);
}

export function normalizeItems(raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	const seen = new Set();
	for (const row of raw) {
		const item = normalizeItem(row);
		if (!item) continue;
		const key = itemKey(item);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}

export function normalizeItem(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const pointer = normalizePointer(raw.pointer);
	if (!pointer) return null;
	const view = normalizeView(raw.view);
	const id =
		typeof raw.id === "string" && raw.id.trim()
			? raw.id.trim()
			: itemIdFromPointer(pointer);
	return {
		id,
		cover: raw.cover === true,
		view,
		pointer,
	};
}

export function normalizeView(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return { mediaType: "image" };
	}
	const mediaType = normalizeMediaType(raw.mediaType || raw.media_type);
	const view = { mediaType };
	const copyStr = (key, dest = key) => {
		if (typeof raw[key] === "string" && raw[key].trim()) view[dest] = raw[key].trim();
	};
	copyStr("title");
	copyStr("url");
	copyStr("thumbnail_url", "thumbnailUrl");
	copyStr("thumbnailUrl");
	copyStr("filename");
	copyStr("file_path", "filePath");
	copyStr("filePath");
	copyStr("color");
	copyStr("status");
	const width = Number(raw.width);
	const height = Number(raw.height);
	if (Number.isFinite(width) && width > 0) view.width = Math.round(width);
	if (Number.isFinite(height) && height > 0) view.height = Math.round(height);
	return view;
}

export function normalizeMediaType(value) {
	const raw = String(value || "").trim().toLowerCase();
	if (raw === "video" || raw === "audio" || raw === "image") return raw;
	return "image";
}

export function normalizePointer(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const kind = String(raw.kind || "").trim();
	if (kind === "local") {
		const uri = String(raw.uri || raw.local || "").trim();
		const parsed = parseLocalUri(uri);
		if (!parsed) return null;
		return { kind: "local", uri: parsed.uri, libraryId: parsed.libraryId, assetId: parsed.assetId };
	}
	const creationId = Number(raw.creation_id ?? raw.creationId ?? raw.id);
	if (!Number.isFinite(creationId) || creationId <= 0) return null;
	return { kind: "creation", creationId };
}

export function parseLocalUri(uri) {
	const raw = String(uri || "").trim();
	const match = LOCAL_POINTER_RE.exec(raw);
	if (!match) return null;
	const libraryId = match[1].trim();
	const assetId = match[2].trim();
	if (!libraryId || !assetId) return null;
	return { uri: `local://${libraryId}/${assetId}`, libraryId, assetId };
}

export function localUri(libraryId, assetId) {
	const lib = String(libraryId || "").trim();
	const id = String(assetId || "").trim();
	if (!lib || !id) return null;
	return `local://${lib}/${id}`;
}

export function creationPointer(creationId) {
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) return null;
	return { kind: "creation", creationId: id };
}

export function localPointer(libraryId, assetId) {
	const parsed = parseLocalUri(localUri(libraryId, assetId));
	if (!parsed) return null;
	return { kind: "local", uri: parsed.uri, libraryId: parsed.libraryId, assetId: parsed.assetId };
}

export function itemIdFromPointer(pointer) {
	if (!pointer) return "";
	if (pointer.kind === "local") return pointer.uri;
	return `creation:${pointer.creationId}`;
}

export function itemKey(item) {
	if (!item?.pointer) return "";
	if (item.pointer.kind === "local") return item.pointer.uri;
	return `creation:${item.pointer.creationId}`;
}

export function samePointer(a, b) {
	if (!a || !b) return false;
	if (a.kind !== b.kind) return false;
	if (a.kind === "local") return a.uri === b.uri;
	return Number(a.creationId) === Number(b.creationId);
}

export function pointerFromMatch(raw) {
	if (raw == null) return null;
	if (typeof raw === "string" || typeof raw === "number") {
		const asLocal = parseLocalUri(String(raw));
		if (asLocal) return localPointer(asLocal.libraryId, asLocal.assetId);
		const n = Number(raw);
		if (Number.isFinite(n) && n > 0) return creationPointer(n);
		if (String(raw).startsWith("creation:")) {
			return creationPointer(String(raw).slice("creation:".length));
		}
		return null;
	}
	if (typeof raw === "object") {
		if (raw.pointer) return normalizePointer(raw.pointer);
		return normalizePointer(raw);
	}
	return null;
}

export function memberCreationIds(items) {
	const ids = [];
	const seen = new Set();
	for (const item of normalizeItems(items)) {
		if (item.pointer.kind !== "creation") continue;
		const id = item.pointer.creationId;
		if (seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

export function coverItem(items) {
	const list = normalizeItems(items);
	return list.find((item) => item.cover) || list[0] || null;
}

export function viewFromCreationRow(row, extra = {}) {
	const meta = parseMeta(row?.meta);
	const mediaType = normalizeMediaType(extra.mediaType || meta.media_type || extra.media_type);
	const title =
		(typeof extra.title === "string" && extra.title.trim()) ||
		(typeof row?.title === "string" && row.title.trim()) ||
		"";
	const filePath =
		(typeof extra.file_path === "string" && extra.file_path.trim()) ||
		(typeof row?.file_path === "string" && row.file_path.trim()) ||
		"";
	const filename =
		(typeof extra.filename === "string" && extra.filename.trim()) ||
		(typeof row?.filename === "string" && row.filename.trim()) ||
		"";
	const url = (typeof extra.url === "string" && extra.url.trim()) || filePath || "";
	return normalizeView({
		mediaType,
		title,
		url,
		thumbnailUrl: extra.thumbnail_url || extra.thumbnailUrl || url || "",
		filename,
		filePath,
		color: row?.color ?? extra.color ?? "",
		status: extra.status || row?.status || "creating",
		width: extra.width ?? row?.width,
		height: extra.height ?? row?.height,
	});
}

export function itemFromCreationRow(row, opts = {}) {
	const pointer = creationPointer(row?.id);
	if (!pointer) return null;
	return normalizeItem({
		id: opts.id,
		cover: opts.cover === true,
		pointer,
		view: viewFromCreationRow(row, opts),
	});
}

export function itemFromLocal(libraryId, assetId, view = {}, cover = false) {
	const pointer = localPointer(libraryId, assetId);
	if (!pointer) return null;
	return normalizeItem({
		cover,
		pointer,
		view,
	});
}

export function appendItems(existing, toAdd) {
	const items = normalizeItems(existing);
	const seen = new Set(items.map(itemKey));
	const added = [];
	for (const raw of Array.isArray(toAdd) ? toAdd : [toAdd]) {
		const item = normalizeItem(raw);
		if (!item) continue;
		const key = itemKey(item);
		if (seen.has(key)) continue;
		seen.add(key);
		items.push(item);
		added.push(item);
	}
	if (items.length > 0 && !items.some((item) => item.cover)) {
		items[0] = { ...items[0], cover: true };
	}
	return { items, added };
}

export function removeItems(existing, matches) {
	const items = normalizeItems(existing);
	const pointers = (Array.isArray(matches) ? matches : [matches])
		.map(pointerFromMatch)
		.filter(Boolean);
	if (pointers.length === 0) return { items, removed: [] };
	const removed = [];
	const next = [];
	for (const item of items) {
		if (pointers.some((pointer) => samePointer(pointer, item.pointer))) {
			removed.push(item);
		} else {
			next.push(item);
		}
	}
	if (next.length > 0 && !next.some((item) => item.cover)) {
		next[0] = { ...next[0], cover: true };
	}
	return { items: next, removed };
}

export function setCoverItem(existing, match) {
	const items = normalizeItems(existing);
	const pointer = pointerFromMatch(match);
	if (!pointer) return items;
	return items.map((item) => ({
		...item,
		cover: samePointer(pointer, item.pointer),
	}));
}

export function withUpdatedItems(meta, items, extra = {}) {
	const current = meta && typeof meta === "object" ? { ...meta } : {};
	const group = current.group && typeof current.group === "object" ? { ...current.group } : {};
	const nextItems = normalizeItems(items);
	return {
		...current,
		...extra,
		group: {
			...group,
			kind: GROUP_V2_KIND,
			version: 2,
			created_at: typeof group.created_at === "string" ? group.created_at : nowIso(),
			updated_at: nowIso(),
			items: nextItems,
		},
	};
}

export function costumeGroupV2Meta(meta, { title } = {}) {
	const items = groupV2Items(meta);
	const snapshots = [];
	for (const item of items) {
		if (item.pointer.kind !== "creation") continue;
		const view = item.view || {};
		snapshots.push({
			order: snapshots.length,
			id: item.pointer.creationId,
			filename: view.filename || null,
			file_path: view.filePath || view.url || null,
			width: view.width ?? null,
			height: view.height ?? null,
			color: view.color || null,
			status: view.status || "completed",
			title: view.title || title || null,
			meta: { media_type: view.mediaType || "image" },
		});
	}
	const cover = coverItem(items);
	const coverId =
		cover?.pointer?.kind === "creation" ? cover.pointer.creationId : snapshots[0]?.id ?? null;
	const createdAt = meta?.group?.created_at || nowIso();
	return {
		...meta,
		media_type: cover?.view?.mediaType || snapshots[0]?.meta?.media_type || meta?.media_type || "image",
		group: {
			kind: "group_creations",
			version: 1,
			grouped_at: createdAt,
			updated_at: meta?.group?.updated_at || createdAt,
			ungroup_supported: false,
			cover_source_id: coverId,
			source_creation_ids: snapshots.map((row) => Number(row.id)),
			source_creations: snapshots,
		},
	};
}

export function applyCostumeToCreationPayload(payload, { raw = false } = {}) {
	if (!payload || typeof payload !== "object") return payload;
	const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
	if (!isGroupV2Meta(meta)) return payload;
	const items = groupV2Items(meta);
	if (raw) {
		return {
			...payload,
			items,
			meta: {
				...meta,
				group: {
					...(meta.group || {}),
					kind: GROUP_V2_KIND,
					version: 2,
					items,
				},
			},
		};
	}
	return {
		...payload,
		meta: costumeGroupV2Meta(meta, { title: payload.title }),
	};
}

export function hiddenGroupIdFromMeta(meta) {
	const current = hiddenId(meta?.[HIDDEN_IN_GROUP_META_KEY]);
	if (current) return current;
	return hiddenId(meta?.[HIDDEN_IN_PROJECT_META_KEY]);
}

function hiddenId(value) {
	const id = Number(value);
	return Number.isFinite(id) && id > 0 ? id : 0;
}

export function isHiddenInGroupMeta(meta) {
	return hiddenGroupIdFromMeta(meta) > 0;
}

export function withHiddenInGroup(meta, groupId) {
	const current = meta && typeof meta === "object" ? { ...meta } : {};
	const id = Number(groupId);
	if (!Number.isFinite(id) || id <= 0) return current;
	const next = { ...current, [HIDDEN_IN_GROUP_META_KEY]: id };
	delete next[HIDDEN_IN_PROJECT_META_KEY];
	return next;
}

export function withoutHiddenInGroup(meta) {
	const current = meta && typeof meta === "object" ? { ...meta } : {};
	delete current[HIDDEN_IN_GROUP_META_KEY];
	delete current[HIDDEN_IN_PROJECT_META_KEY];
	return current;
}

export function groupV2RejectMessage(action) {
	if (action === "ungroup") return "This group cannot be ungrouped";
	if (action === "group") return "Cannot wrap a group v2 with a v1 group";
	return "This group cannot be changed that way";
}
