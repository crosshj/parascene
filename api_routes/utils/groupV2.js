/** Generic group v2 list: 1-to-1 view+pointer rows. Not a project API. */

export const GROUP_V2_KIND = "group_v2";
export const HIDDEN_IN_GROUP_META_KEY = "hidden_in_group";
/** Read-only alias for rows written before the generic hide key. */
export const HIDDEN_IN_PROJECT_META_KEY = "hidden_in_project";
export const DESKTOP_HEADER = "x-parascene-desktop";
const PROJECT_TYPE_STAMP = "project";

export const GROUP_SUPPORTED_KEYS = [
	"ungroup",
	"reorder",
	"set_cover",
	"publish",
	"delete",
	"edit",
	"share",
	"remix",
	"challenge_submit",
	"challenge_assign",
	"carousel",
];

/** Bare group v2: old group chrome cannot write this list. Missing keys stay on. */
export const GROUP_V2_SUPPORTED = {
	ungroup: false,
	reorder: false,
	set_cover: false,
};

/** Project container: www is a viewer. */
export const PROJECT_GROUP_SUPPORTED = {
	ungroup: false,
	reorder: false,
	set_cover: false,
	publish: false,
	delete: false,
	edit: false,
	share: false,
	remix: false,
	challenge_submit: false,
	challenge_assign: false,
	carousel: false,
};

export function normalizeGroupSupported(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const out = {};
	let any = false;
	for (const key of GROUP_SUPPORTED_KEYS) {
		if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
		out[key] = raw[key] !== false;
		any = true;
	}
	return any ? out : null;
}

function isProjectTypeStamp(meta) {
	return String(meta?.type || meta?.creation_type || "").trim() === PROJECT_TYPE_STAMP;
}

function defaultSupportedForMeta(meta) {
	if (!isGroupV2Meta(meta)) return null;
	return isProjectTypeStamp(meta) ? { ...PROJECT_GROUP_SUPPORTED } : { ...GROUP_V2_SUPPORTED };
}

export function resolveGroupSupported(meta) {
	const stored = normalizeGroupSupported(meta?.group?.supported);
	const defaults = defaultSupportedForMeta(meta);
	if (!defaults && !stored) return null;
	return { ...(defaults || {}), ...(stored || {}) };
}

/** www: missing object/key means show (v1 groups). */
export function groupActionSupported(group, key) {
	if (!group || typeof group !== "object") return true;
	const supported = group.supported;
	if (!supported || typeof supported !== "object" || Array.isArray(supported)) {
		if (key === "ungroup" && group.ungroup_supported === false) return false;
		return true;
	}
	if (!Object.prototype.hasOwnProperty.call(supported, key)) return true;
	return supported[key] !== false;
}

export function groupActionSupportedForMeta(meta, key) {
	const resolved = resolveGroupSupported(meta);
	if (!resolved) return groupActionSupported(meta?.group, key);
	if (!Object.prototype.hasOwnProperty.call(resolved, key)) return true;
	return resolved[key] !== false;
}

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
	const supported = {
		...GROUP_V2_SUPPORTED,
		...(normalizeGroupSupported(opts.supported) || {}),
	};
	const badge = typeof opts.badge === "string" && opts.badge.trim() ? opts.badge.trim() : "";
	return {
		group: {
			kind: GROUP_V2_KIND,
			version: 2,
			created_at: createdAt,
			updated_at: createdAt,
			items,
			supported,
			...(badge ? { badge } : {}),
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
	copyStr("videoUrl");
	copyStr("video_url", "videoUrl");
	const width = Number(raw.width);
	const height = Number(raw.height);
	if (Number.isFinite(width) && width > 0) view.width = Math.round(width);
	if (Number.isFinite(height) && height > 0) view.height = Math.round(height);
	const audio = raw.audio;
	if (audio && typeof audio === "object" && !Array.isArray(audio)) {
		const cdnId = typeof audio.cdn_id === "string" ? audio.cdn_id.trim() : "";
		if (cdnId) {
			view.audio = {
				cdn_id: cdnId,
				...(typeof audio.filename === "string" && audio.filename.trim()
					? { filename: audio.filename.trim() }
					: {}),
				...(typeof audio.content_type === "string" && audio.content_type.trim()
					? { content_type: audio.content_type.trim() }
					: {}),
				...(Number(audio.duration) > 0 ? { duration: Number(audio.duration) } : {}),
			};
		}
	}
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
	const view = normalizeView({
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
	const videoPath =
		(typeof extra.video?.file_path === "string" && extra.video.file_path.trim()) ||
		(typeof extra.videoUrl === "string" && extra.videoUrl.trim()) ||
		(typeof meta.video?.file_path === "string" && meta.video.file_path.trim()) ||
		"";
	if (videoPath) view.videoUrl = videoPath;
	const audioIn = extra.audio && typeof extra.audio === "object" ? extra.audio : meta.audio;
	if (audioIn && typeof audioIn === "object") {
		const cdnId = typeof audioIn.cdn_id === "string" ? audioIn.cdn_id.trim() : "";
		if (cdnId) {
			view.audio = {
				cdn_id: cdnId,
				...(typeof audioIn.filename === "string" && audioIn.filename.trim()
					? { filename: audioIn.filename.trim() }
					: {}),
				...(typeof audioIn.content_type === "string" && audioIn.content_type.trim()
					? { content_type: audioIn.content_type.trim() }
					: {}),
				...(Number(audioIn.duration) > 0 ? { duration: Number(audioIn.duration) } : {}),
			};
		}
	}
	return view;
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
	const nextGroup = {
		...group,
		kind: GROUP_V2_KIND,
		version: 2,
		created_at: typeof group.created_at === "string" ? group.created_at : nowIso(),
		updated_at: nowIso(),
		items: nextItems,
	};
	const supported = resolveGroupSupported({ ...current, ...extra, group: nextGroup });
	if (supported) nextGroup.supported = supported;
	return {
		...current,
		...extra,
		group: nextGroup,
	};
}

export function costumeGroupV2Meta(meta, { title } = {}) {
	const items = groupV2Items(meta);
	const snapshots = [];
	for (const item of items) {
		if (item.pointer.kind !== "creation") continue;
		const view = item.view || {};
		const mediaType = view.mediaType || "image";
		const snapshotMeta = { media_type: mediaType };
		if (view.videoUrl) snapshotMeta.video = { file_path: view.videoUrl };
		if (view.audio && typeof view.audio === "object") snapshotMeta.audio = view.audio;
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
			meta: snapshotMeta,
		});
	}
	const cover = coverItem(items);
	const coverId =
		cover?.pointer?.kind === "creation" ? cover.pointer.creationId : snapshots[0]?.id ?? null;
	const createdAt = meta?.group?.created_at || nowIso();
	const supported = resolveGroupSupported(meta) || { ...GROUP_V2_SUPPORTED };
	const badge =
		(typeof meta?.group?.badge === "string" && meta.group.badge.trim()) ||
		(isProjectTypeStamp(meta) ? "project" : "");
	return {
		...meta,
		media_type: cover?.view?.mediaType || snapshots[0]?.meta?.media_type || meta?.media_type || "image",
		group: {
			kind: "group_creations",
			version: 1,
			grouped_at: createdAt,
			updated_at: meta?.group?.updated_at || createdAt,
			ungroup_supported: supported.ungroup !== false,
			supported,
			...(badge ? { badge } : {}),
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
	const costumedMeta = costumeGroupV2Meta(meta, { title: payload.title });
	const cover = coverItem(items);
	const view = cover?.view || {};
	const coverUrl = view.url || view.filePath || "";
	const mediaType =
		view.mediaType ||
		(payload.media_type === "project" ? "image" : payload.media_type) ||
		"image";
	return {
		...payload,
		meta: costumedMeta,
		media_type: mediaType,
		url: payload.url || coverUrl || null,
		thumbnail_url: payload.thumbnail_url || view.thumbnailUrl || coverUrl || null,
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
