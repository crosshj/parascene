import {
	appendItems,
	applyCostumeToCreationPayload,
	emptyGroupV2Meta,
	groupV2Items,
	groupV2RejectMessage,
	isGroupV2Meta,
	itemFromCreationRow,
	normalizeItem,
	parseMeta,
	removeItems,
	setCoverItem,
	wantsRawGroupV2,
	withHiddenInGroup,
	withoutHiddenInGroup,
	withUpdatedItems,
} from "./groupV2.js";
import { emptyProjectV2Meta, wantsProjectGroupType } from "./projectGroupV2.js";

export async function loadOwnedGroupV2(queries, id, userId) {
	const n = Number(id);
	if (!Number.isFinite(n) || n <= 0) return null;
	const row = await queries.selectCreatedImageById.get(n, userId);
	if (!row) return null;
	const meta = parseMeta(row.meta) || {};
	if (!isGroupV2Meta(meta)) return null;
	return { row, meta };
}

export async function resolveOwnedGroupV2Id(queries, userId, requestedGroupId) {
	if (!requestedGroupId) return { groupId: null };
	const loaded = await loadOwnedGroupV2(queries, requestedGroupId, userId);
	if (loaded) return { groupId: Number(loaded.row.id) };
	const anyGroup = await queries.selectCreatedImageByIdAnyUser?.get(requestedGroupId);
	if (anyGroup && isGroupV2Meta(parseMeta(anyGroup.meta) || {})) {
		return { error: "Group not found", status: 404 };
	}
	return { groupId: null };
}

export async function persistGroupV2Meta(queries, row, userId, nextMeta) {
	const result = await queries.updateCreatedImageMeta.run(row.id, userId, nextMeta);
	if (!result || result.changes === 0) {
		throw new Error("Failed to update group");
	}
	return nextMeta;
}

export async function setMemberHiddenInGroup(queries, creationId, userId, groupId, hidden) {
	const row = await queries.selectCreatedImageById.get(creationId, userId);
	if (!row) return;
	const meta = parseMeta(row.meta) || {};
	const next = hidden ? withHiddenInGroup(meta, groupId) : withoutHiddenInGroup(meta);
	await queries.updateCreatedImageMeta.run(creationId, userId, next);
}

export async function appendCreationToOwnedGroupV2(queries, opts) {
	const loaded = await loadOwnedGroupV2(queries, opts.groupId, opts.userId);
	if (!loaded) return { ok: false, error: "Not a group v2" };
	const item = itemFromCreationRow(opts.createdRow, {
		mediaType: opts.mediaType,
		cover: opts.cover === true,
		status: opts.createdRow?.status,
	});
	if (!item) return { ok: false, error: "Invalid creation" };
	const { items, added } = appendItems(groupV2Items(loaded.meta), item);
	if (added.length === 0) return { ok: true, meta: loaded.meta, items };
	const nextMeta = withUpdatedItems(loaded.meta, items);
	await persistGroupV2Meta(queries, loaded.row, opts.userId, nextMeta);
	await setMemberHiddenInGroup(queries, opts.createdRow.id, opts.userId, loaded.row.id, true);
	return { ok: true, meta: nextMeta, items };
}

export function jsonGroupV2(row, req, extra = {}) {
	const meta = parseMeta(row?.meta) || {};
	const payload = {
		id: row.id,
		filename: row.filename,
		status: row.status || "completed",
		published: row.published === 1 || row.published === true,
		title: row.title || extra.title || null,
		description: row.description || null,
		created_at: row.created_at,
		items: groupV2Items(meta),
		meta,
		...extra,
	};
	if (payload.type == null && meta.type) payload.type = meta.type;
	return applyCostumeToCreationPayload(payload, { raw: wantsRawGroupV2(req) });
}

export async function collectGroupV2ItemsFromBody(queries, userId, body) {
	const incoming = [];
	const rawItems = Array.isArray(body?.items) ? body.items : [];
	for (const raw of rawItems) {
		const item = normalizeItem(raw);
		if (item) incoming.push(item);
	}
	const ids = Array.isArray(body?.ids) ? body.ids : [];
	for (const rawId of ids) {
		const id = Number(rawId);
		if (!Number.isFinite(id) || id <= 0) continue;
		const row = await queries.selectCreatedImageById.get(id, userId);
		if (!row) {
			return { error: `Creation ${id} not found`, status: 404 };
		}
		if (isGroupV2Meta(parseMeta(row.meta) || {})) {
			return { error: groupV2RejectMessage("group"), status: 400 };
		}
		const item = itemFromCreationRow(row, { cover: incoming.length === 0 });
		if (item) incoming.push(item);
	}
	return { items: appendItems([], incoming).items };
}

export async function applyGroupV2Patch(queries, loaded, userId, body) {
	let items = groupV2Items(loaded.meta);
	if (body?.add != null) {
		const toAdd = [];
		const addRaw = Array.isArray(body.add) ? body.add : [body.add];
		for (const raw of addRaw) {
			if (raw && typeof raw === "object" && (raw.pointer || raw.kind === "local" || raw.uri)) {
				const item = normalizeItem(raw);
				if (item) toAdd.push(item);
				continue;
			}
			const id = Number(raw?.creation_id ?? raw?.creationId ?? raw?.id ?? raw);
			if (!Number.isFinite(id) || id <= 0) continue;
			const row = await queries.selectCreatedImageById.get(id, userId);
			if (!row) {
				return { error: `Creation ${id} not found`, status: 404 };
			}
			if (isGroupV2Meta(parseMeta(row.meta) || {})) {
				return { error: groupV2RejectMessage("group"), status: 400 };
			}
			const item = itemFromCreationRow(row);
			if (item) toAdd.push(item);
		}
		const appended = appendItems(items, toAdd);
		items = appended.items;
		for (const item of appended.added) {
			if (item.pointer.kind === "creation") {
				await setMemberHiddenInGroup(queries, item.pointer.creationId, userId, loaded.row.id, true);
			}
		}
	}
	if (body?.remove != null) {
		const removed = removeItems(items, body.remove);
		items = removed.items;
		for (const item of removed.removed) {
			if (item.pointer.kind === "creation") {
				await setMemberHiddenInGroup(queries, item.pointer.creationId, userId, loaded.row.id, false);
			}
		}
	}
	if (body?.cover != null) {
		items = setCoverItem(items, body.cover);
	}
	let nextMeta = withUpdatedItems(loaded.meta, items);
	if (body?.lean_meta && typeof body.lean_meta === "object") {
		nextMeta = {
			...nextMeta,
			lean: { ...(nextMeta.lean || {}), ...body.lean_meta },
		};
	}
	await persistGroupV2Meta(queries, loaded.row, userId, nextMeta);
	const title = typeof body?.title === "string" ? body.title.trim() : "";
	if (title) {
		await queries.updateCreatedImage.run(
			loaded.row.id,
			userId,
			title,
			loaded.row.description ?? null,
			false
		);
	}
	return { title };
}

export async function insertGroupV2(queries, userId, body) {
	const collected = await collectGroupV2ItemsFromBody(queries, userId, body);
	if (collected.error) return collected;
	const items = collected.items;
	const project = wantsProjectGroupType(body);
	const meta = project ? emptyProjectV2Meta({ items }) : emptyGroupV2Meta({ items });
	const prefix = project ? "project" : "group_v2";
	const filename = `${prefix}/${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
	const insertResult = await queries.insertCreatedImage.run(
		userId,
		filename,
		"",
		1024,
		1024,
		null,
		"completed",
		meta
	);
	const groupId = Number(insertResult?.insertId);
	if (!Number.isFinite(groupId) || groupId <= 0) {
		return { error: "Failed to create group", status: 500 };
	}
	const title = typeof body?.title === "string" ? body.title.trim() : "";
	if (title) {
		await queries.updateCreatedImage.run(groupId, userId, title, null, false);
	}
	for (const item of items) {
		if (item.pointer.kind === "creation") {
			await setMemberHiddenInGroup(queries, item.pointer.creationId, userId, groupId, true);
		}
	}
	const row = await queries.selectCreatedImageById.get(groupId, userId);
	if (!row) return { error: "Failed to load group", status: 500 };
	return { row, title };
}
