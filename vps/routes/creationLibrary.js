// Library mutations ported from WWW api_routes/create.js. Authentication and storage are VPS-owned.
import { isCreationFinishTimedOut, isCreationGpuInFlight } from '../services/create/creationGpuWait.js';
import { getCreationFeedPinStatus } from '../services/feed/editorialPin.js';
import { challengeArchiveBlockMessage, challengeArchiveBlockMessageForKind, stripChallengeStampsFromCreationMeta } from '../client/shared/challengeSubmitMeta.js';
import { withGroupAspectRatioFromFirst } from '../services/create/fitThumbnail.js';
import { isGroupV2Meta, groupV2RejectMessage } from '../services/create/projectGroupV2.js';
import { getSupabaseServiceClient } from '../services/create/supabaseService.js';
import { deleteCdnObjectBestEffort } from '../services/create/blueCdn.js';
import { deleteCreationEmbedding } from '../services/create/deleteCreationEmbedding.js';

export function registerCreationLibraryRoutes({ router, requireUser, queries, storage }) {
function parseMeta(raw) {
		if (raw == null) return null;
		if (typeof raw === "object") return raw;
		if (typeof raw !== "string") return null;
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	}

async function challengeArchiveBlockForCreation(imageId, meta, actionWord) {
		const fromMeta = challengeArchiveBlockMessage(meta, actionWord);
		if (fromMeta) return fromMeta;
		try {
			const pinStatus = await getCreationFeedPinStatus(queries, imageId, { meta });
			if (pinStatus?.active) {
				return challengeArchiveBlockMessageForKind("organizer", actionWord);
			}
		} catch {
			// meta pins already covered
		}
		return null;
	}

function resolveCreationMediaType(meta) {
		return typeof meta?.media_type === "string" ? meta.media_type : "image";
	}

function applyGroupMediaTypeFromCoverMeta(groupMeta, coverSourceMeta) {
		const next = groupMeta && typeof groupMeta === "object" ? { ...groupMeta } : {};
		const coverMeta = coverSourceMeta && typeof coverSourceMeta === "object" ? coverSourceMeta : {};
		const coverMediaType = resolveCreationMediaType(coverMeta);
		next.media_type = coverMediaType;
		if (coverMediaType === "video" && coverMeta.video && typeof coverMeta.video === "object") {
			next.video = { ...coverMeta.video };
		}
		return next;
	}

function syncGroupLineageFromCoverMeta(groupMeta, coverMeta) {
		const next = groupMeta && typeof groupMeta === "object" ? { ...groupMeta } : {};
		const source = coverMeta && typeof coverMeta === "object" ? coverMeta : {};
		const lineageKeys = ["history", "mutate_of_id", "direct_parent_ids"];
		for (const key of lineageKeys) {
			if (Object.prototype.hasOwnProperty.call(source, key)) {
				next[key] = source[key];
			} else {
				delete next[key];
			}
		}
		return next;
	}

function normalizeGroupCoverFilePath(rawPath) {
		const path = typeof rawPath === "string" ? rawPath.trim() : "";
		if (!path) return "";
		try {
			const parsed = new URL(path, "http://localhost");
			if (parsed.searchParams.get("variant") === "thumbnail") {
				parsed.searchParams.delete("variant");
			}
			return `${parsed.pathname}${parsed.search}${parsed.hash}`;
		} catch {
			return path.replace(/([?&])variant=thumbnail(&)?/g, (_, lead, tail) => {
				if (lead === "?" && tail) return "?";
				if (lead === "?" && !tail) return "";
				if (lead === "&" && tail) return "&";
				return "";
			}).replace(/\?$/, "");
		}
	}

function buildGroupCoverUpdateState({
		groupMeta,
		groupPayload,
		sourceCreations,
		coverSourceId,
		storage,
		fallbackGroupRow
	}) {
		const sourceList = Array.isArray(sourceCreations)
			? sourceCreations.filter((item) => item && typeof item === "object")
			: [];
		const selectedSource = sourceList.find((item) => Number(item.id) === Number(coverSourceId));
		if (!selectedSource) return null;

		const reorderedSources = [
			selectedSource,
			...sourceList.filter((item) => Number(item.id) !== Number(coverSourceId))
		].map((item, index) => ({ ...item, order: index }));

		const nextMetaBase = {
			...(groupMeta && typeof groupMeta === "object" ? groupMeta : {}),
			group: {
				...(groupPayload && typeof groupPayload === "object" ? groupPayload : {}),
				updated_at: nowIso(),
				cover_source_id: Number(coverSourceId),
				source_creation_ids: reorderedSources
					.map((item) => Number(item.id))
					.filter((n, idx, arr) => Number.isFinite(n) && n > 0 && arr.indexOf(n) === idx),
				source_creations: reorderedSources
			}
		};
		const nextMetaSynced = applyGroupMediaTypeFromCoverMeta(
			syncGroupLineageFromCoverMeta(nextMetaBase, selectedSource.meta),
			selectedSource.meta
		);
		// First listed source ≡ cover after reorder above — drive pack aspect from that member.
		const nextMeta = withGroupAspectRatioFromFirst(nextMetaSynced, selectedSource);

		const selectedFilePath = normalizeGroupCoverFilePath(
			typeof selectedSource.filename === "string" && selectedSource.filename
				? storage.getImageUrl(selectedSource.filename)
				: (typeof selectedSource.file_path === "string" && selectedSource.file_path
					? selectedSource.file_path
					: "")
		);
		const fallbackFilePath = normalizeGroupCoverFilePath(fallbackGroupRow?.file_path || "");
		const nextWidth = Number.isFinite(Number(selectedSource.width))
			? Number(selectedSource.width)
			: fallbackGroupRow?.width;
		const nextHeight = Number.isFinite(Number(selectedSource.height))
			? Number(selectedSource.height)
			: fallbackGroupRow?.height;
		const nextCreatedAt = selectedSource.created_at || fallbackGroupRow?.created_at || nowIso();
		const nextColor = selectedSource.color ?? fallbackGroupRow?.color ?? null;

		return {
			selectedSource,
			reorderedSources,
			meta: nextMeta,
			updatePayload: {
				created_at: nextCreatedAt,
				file_path: selectedFilePath || fallbackFilePath,
				width: nextWidth,
				height: nextHeight,
				color: nextColor,
				meta: nextMeta
			}
		};
	}

function nowIso() {
		return new Date().toISOString();
	}

function parsePartySettingsPayload(raw) {
		if (!raw || typeof raw !== "object") return null;
		const partyName = typeof raw.partyName === "string" ? raw.partyName.trim() : "";
		const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
		const autoReviewReady = raw.autoReviewReady === true;
		if (!partyName && !prompt && !autoReviewReady) return null;
		return {
			version: 1,
			partyName,
			prompt,
			autoReviewReady
		};
	}

function buildPartyGroupMeta(partyName, partySettings) {
		const name = String(partyName || partySettings?.partyName || "").trim();
		if (!name && !partySettings) return null;
		return {
			mode: true,
			...(name ? { name } : {}),
			...(partySettings ? { settings: partySettings } : {})
		};
	}

router.post("/api/create/images/group", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
			const partySettingsParsed = parsePartySettingsPayload(req.body?.party_settings);
			const partyNameRaw = typeof req.body?.party_name === "string" ? req.body.party_name.trim() : "";
			const effectivePartyName = partyNameRaw || partySettingsParsed?.partyName || "";
			const ids = [];
			const seen = new Set();
			for (const raw of rawIds) {
				const n = Number(raw);
				if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
				seen.add(n);
				ids.push(n);
			}
			if (ids.length < 1) {
				return res.status(400).json({ error: "No creations selected" });
			}
			if (ids.length < 2 && !effectivePartyName) {
				return res.status(400).json({ error: "Select at least 2 creations to group" });
			}

			const selectedRows = [];
			let groupMediaType = null;
			for (const id of ids) {
				const row = await queries.selectCreatedImageById.get(id, user.id);
				if (!row) {
					return res.status(404).json({ error: `Creation ${id} not found` });
				}
				const isPublished = row.published === 1 || row.published === true;
				if (isPublished) {
					return res.status(400).json({ error: "Published creations cannot be grouped" });
				}
				const unavailable = row.unavailable_at != null && row.unavailable_at !== "";
				if (unavailable) {
					return res.status(400).json({ error: "Cannot group deleted creations" });
				}
				const status = String(row.status || "completed");
				if (status !== "completed") {
					return res.status(400).json({ error: "Only completed creations can be grouped" });
				}
				const sourceMeta = parseMeta(row.meta) || {};
				const mediaType = resolveCreationMediaType(sourceMeta);
				if (mediaType !== "image" && mediaType !== "video") {
					return res.status(400).json({ error: "Only image or video creations can be grouped" });
				}
				if (groupMediaType == null) {
					groupMediaType = mediaType;
				} else if (groupMediaType !== mediaType) {
					return res.status(400).json({ error: "Cannot mix image and video creations in one group" });
				}
				selectedRows.push(row);
			}

			const selectedWithMeta = selectedRows.map((row) => ({
				row,
				meta: parseMeta(row.meta) || {},
				isGroup: (parseMeta(row.meta) || {})?.group?.kind === "group_creations"
			}));
			if (selectedWithMeta.some((entry) => isGroupV2Meta(entry.meta))) {
				return res.status(400).json({ error: groupV2RejectMessage("group") });
			}
			const selectedGroups = selectedWithMeta.filter((entry) => entry.isGroup);
			if (selectedGroups.length > 1) {
				return res.status(400).json({ error: "Select at most one existing group" });
			}

			if (selectedGroups.length === 1) {
				const targetGroupRow = selectedGroups[0].row;
				const targetGroupMeta = selectedGroups[0].meta;
				const rowsToAdd = selectedWithMeta
					.filter((entry) => Number(entry.row.id) !== Number(targetGroupRow.id))
					.map((entry) => entry.row);
				if (rowsToAdd.length === 0) {
					return res.status(400).json({ error: "Select at least one non-group creation to add" });
				}
				for (const row of rowsToAdd) {
					const rowMeta = parseMeta(row.meta) || {};
					const challengeBlock = await challengeArchiveBlockForCreation(
						row.id,
						rowMeta,
						"grouping"
					);
					if (challengeBlock) {
						return res.status(400).json({ error: challengeBlock });
					}
				}
				const existingGroupMediaType = resolveCreationMediaType(targetGroupMeta);
				for (const row of rowsToAdd) {
					const rowMeta = parseMeta(row.meta) || {};
					if (rowMeta?.group?.kind === "group_creations") {
						return res.status(400).json({ error: "Cannot add a group into another group" });
					}
					if (resolveCreationMediaType(rowMeta) !== existingGroupMediaType) {
						return res.status(400).json({ error: "Cannot mix image and video creations in one group" });
					}
				}

				const existingSourcesRaw = Array.isArray(targetGroupMeta?.group?.source_creations)
					? targetGroupMeta.group.source_creations
					: [];
				const existingSources = existingSourcesRaw.filter((item) => item && typeof item === "object");
				const existingIdSet = new Set(
					existingSources
						.map((item) => Number(item.id))
						.filter((n) => Number.isFinite(n) && n > 0)
				);
				const nextOrderStart = existingSources.length;
				const appendedSources = [];
				for (const [index, row] of rowsToAdd.entries()) {
					if (existingIdSet.has(Number(row.id))) continue;
					const rowMeta = parseMeta(row.meta);
					appendedSources.push({
						order: nextOrderStart + index,
						id: row.id,
						user_id: row.user_id,
						filename: row.filename,
						file_path: typeof row.filename === "string" && row.filename
							? storage.getImageUrl(row.filename)
							: row.file_path,
						width: row.width,
						height: row.height,
						color: row.color,
						status: row.status || "completed",
						created_at: row.created_at,
						published: row.published === 1 || row.published === true,
						published_at: row.published_at || null,
						title: row.title ?? null,
						description: row.description ?? null,
						meta: rowMeta && typeof rowMeta === "object" ? rowMeta : null
					});
				}
				if (appendedSources.length === 0) {
					return res.status(400).json({ error: "No new creations selected to add to this group" });
				}
				const mergedSources = [...existingSources, ...appendedSources];
				const isPartyGroup = targetGroupMeta?.party?.mode === true;
				const lastAppendedId = Number(appendedSources[appendedSources.length - 1]?.id);
				const defaultCoverSourceId = Number(targetGroupMeta?.group?.cover_source_id) > 0
					? Number(targetGroupMeta.group.cover_source_id)
					: Number(existingSources[0]?.id ?? appendedSources[0]?.id ?? 0);
				const nextCoverSourceId =
					isPartyGroup && Number.isFinite(lastAppendedId) && lastAppendedId > 0
						? lastAppendedId
						: defaultCoverSourceId;
				const mergedMetaBase = {
					...targetGroupMeta,
					media_type: existingGroupMediaType,
					group: {
						...(targetGroupMeta.group || {}),
						kind: "group_creations",
						version: 1,
						grouped_at: typeof targetGroupMeta?.group?.grouped_at === "string"
							? targetGroupMeta.group.grouped_at
							: nowIso(),
						updated_at: nowIso(),
						ungroup_supported: true,
						cover_source_id: nextCoverSourceId,
						source_creation_ids: mergedSources
							.map((item) => Number(item.id))
							.filter((n, idx, arr) => Number.isFinite(n) && n > 0 && arr.indexOf(n) === idx),
						source_creations: mergedSources
					}
				};
				let mergedMeta = mergedMetaBase;
				if (isPartyGroup && Number.isFinite(nextCoverSourceId) && nextCoverSourceId > 0) {
					const coverState = buildGroupCoverUpdateState({
						groupMeta: mergedMetaBase,
						groupPayload: mergedMetaBase.group,
						sourceCreations: mergedSources,
						coverSourceId: nextCoverSourceId,
						storage,
						fallbackGroupRow: targetGroupRow
					});
					if (!coverState) {
						return res.status(500).json({ error: "Failed to build party group cover" });
					}
					const updateCoverResult = await queries.updateCreatedImageGroupCover?.run(
						targetGroupRow.id,
						user.id,
						coverState.updatePayload
					);
					if (!updateCoverResult || updateCoverResult.changes === 0) {
						return res.status(500).json({ error: "Failed to update party group cover" });
					}
					mergedMeta = coverState.meta;
				} else {
					const updateMetaResult = await queries.updateCreatedImageMeta.run(
						targetGroupRow.id,
						user.id,
						mergedMeta
					);
					if (!updateMetaResult || updateMetaResult.changes === 0) {
						return res.status(500).json({ error: "Failed to update grouped creation" });
					}
				}
				for (const row of rowsToAdd) {
					const markResult = await queries.markCreatedImageUnavailable?.run(row.id, user.id);
					if (!markResult || markResult.changes === 0) {
						return res.status(500).json({ error: "Failed to archive grouped source creations" });
					}
				}
				const updatedGroup = await queries.selectCreatedImageById.get(targetGroupRow.id, user.id);
				return res.json({
					ok: true,
					mode: "add_to_existing_group",
					grouped_creation: {
						id: updatedGroup?.id ?? targetGroupRow.id,
						status: updatedGroup?.status || "completed",
						published: (updatedGroup?.published === 1 || updatedGroup?.published === true) === true,
						meta: parseMeta(updatedGroup?.meta) || mergedMeta
					},
					source_creation_ids: rowsToAdd.map((row) => Number(row.id))
				});
			}

			const sourceRows = selectedRows;
			for (const row of sourceRows) {
				const rowMeta = parseMeta(row.meta) || {};
				const challengeBlock = await challengeArchiveBlockForCreation(row.id, rowMeta, "grouping");
				if (challengeBlock) {
					return res.status(400).json({ error: challengeBlock });
				}
			}
			const first = sourceRows[0];
			const groupedAt = nowIso();
			const firstFilenameRaw = typeof first.filename === "string" ? first.filename.trim() : "";
			const firstExtMatch = firstFilenameRaw.match(/(\.[a-z0-9]+)$/i);
			const firstExt = firstExtMatch ? firstExtMatch[1] : ".png";
			const groupedFilename = `group/${user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}${firstExt}`;
			const fallbackGroupRow = {
				file_path:
					typeof first.file_path === "string" && first.file_path
						? first.file_path
						: storage.getImageUrl(first.filename),
				width: first.width,
				height: first.height,
				color: first.color ?? null,
				created_at: first.created_at
			};
			const sourceCreations = sourceRows.map((row, index) => {
				const rowMeta = parseMeta(row.meta);
				return {
					order: index,
					id: row.id,
					user_id: row.user_id,
					filename: row.filename,
					file_path: typeof row.filename === "string" && row.filename
						? storage.getImageUrl(row.filename)
						: row.file_path,
					width: row.width,
					height: row.height,
					color: row.color,
					status: row.status || "completed",
					created_at: row.created_at,
					published: row.published === 1 || row.published === true,
					published_at: row.published_at || null,
					title: row.title ?? null,
					description: row.description ?? null,
					meta: rowMeta && typeof rowMeta === "object" ? rowMeta : null
				};
			});
			const partyMetaBlock = buildPartyGroupMeta(effectivePartyName, partySettingsParsed);
			const firstMeta = stripChallengeStampsFromCreationMeta(parseMeta(first.meta) || {});
			const groupedMetaBase = {
				...firstMeta,
				media_type: groupMediaType || resolveCreationMediaType(firstMeta),
				...(partyMetaBlock ? { party: partyMetaBlock } : {}),
				group: {
					kind: "group_creations",
					version: 1,
					grouped_at: groupedAt,
					ungroup_supported: true,
					cover_source_id: Number(first.id),
					source_creation_ids: sourceRows.map((row) => Number(row.id)),
					source_creations: sourceCreations
				}
			};
			const initialCoverState = buildGroupCoverUpdateState({
				groupMeta: groupedMetaBase,
				groupPayload: groupedMetaBase.group,
				sourceCreations,
				coverSourceId: Number(first.id),
				storage,
				fallbackGroupRow
			});
			if (!initialCoverState) {
				return res.status(500).json({ error: "Failed to build grouped creation cover" });
			}

			const insertResult = await queries.insertCreatedImage.run(
				user.id,
				groupedFilename,
				initialCoverState.updatePayload.file_path,
				initialCoverState.updatePayload.width,
				initialCoverState.updatePayload.height,
				initialCoverState.updatePayload.color,
				"completed",
				initialCoverState.meta
			);
			const groupedId = Number(insertResult?.insertId);
			if (!Number.isFinite(groupedId) || groupedId <= 0) {
				return res.status(500).json({ error: "Failed to create grouped creation" });
			}
			const setCoverCreatedAt = await queries.updateCreatedImageGroupCover?.run(
				groupedId,
				user.id,
				initialCoverState.updatePayload
			);
			if (!setCoverCreatedAt || setCoverCreatedAt.changes === 0) {
				return res.status(500).json({ error: "Failed to set grouped creation cover timestamp" });
			}

			if (effectivePartyName) {
				await queries.updateCreatedImage.run(groupedId, user.id, effectivePartyName, null, false);
			}

			for (const row of sourceRows) {
				const markResult = await queries.markCreatedImageUnavailable?.run(row.id, user.id);
				if (!markResult || markResult.changes === 0) {
					return res.status(500).json({ error: "Failed to archive grouped source creations" });
				}
			}

			const grouped = await queries.selectCreatedImageById.get(groupedId, user.id);
			if (!grouped) {
				return res.status(500).json({ error: "Failed to load grouped creation" });
			}
			const groupedMetaOut = parseMeta(grouped.meta);
			return res.json({
				ok: true,
				mode: effectivePartyName && sourceRows.length === 1 ? "create_party_group" : "create_group",
				grouped_creation: {
					id: grouped.id,
					status: grouped.status || "completed",
					published: grouped.published === 1 || grouped.published === true,
					meta: groupedMetaOut
				},
				source_creation_ids: sourceRows.map((row) => Number(row.id))
			});
		} catch (error) {
			return res.status(500).json({ error: "Failed to group creations" });
		}
	});

router.delete("/api/create/images/:id", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const permanent = req.query?.permanent === "1" || req.body?.permanent === true;
		const isAdmin = user.role === "admin";

		try {
			if (isAdmin && permanent) {
				// Admin permanent delete: any image, full cleanup (main image + landscape if present)
				const image = await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);
				if (!image) {
					return res.status(404).json({ error: "Image not found" });
				}
				const ownerId = image.user_id;
				try {
					if (image.filename && image.file_path && storage?.deleteImage) {
						await storage.deleteImage(image.filename);
					}
				} catch (storageError) {
					// Log but don't fail
				}
				const permMeta = parseMeta(image.meta) || {};
				if (permMeta.landscapeFilename && storage?.deleteImage) {
					try {
						await storage.deleteImage(permMeta.landscapeFilename);
					} catch (landscapeStorageError) {
						// Log but don't fail
					}
				}
				if (queries.deleteFeedItemByCreatedImageId?.run) {
					await queries.deleteFeedItemByCreatedImageId.run(parseInt(req.params.id));
				}
				if (queries.deleteAllLikesForCreatedImage?.run) {
					await queries.deleteAllLikesForCreatedImage.run(parseInt(req.params.id));
				}
				if (queries.deleteAllCommentsForCreatedImage?.run) {
					await queries.deleteAllCommentsForCreatedImage.run(parseInt(req.params.id));
				}
				const deleteResult = await queries.deleteCreatedImageById.run(req.params.id, ownerId);
				if (deleteResult.changes === 0) {
					return res.status(500).json({ error: "Failed to delete image" });
				}
				const audioCdnId =
					typeof permMeta?.audio?.cdn_id === "string" ? permMeta.audio.cdn_id.trim() : "";
				if (audioCdnId) {
					await deleteCdnObjectBestEffort(queries, audioCdnId);
				}
				return res.json({ success: true, message: "Image permanently deleted" });
			}

			// Owner (or admin without permanent): mark unavailable so it no longer shows anywhere except admin
			const image = await queries.selectCreatedImageById.get(req.params.id, user.id);
			if (!image) {
				return res.status(404).json({ error: "Image not found" });
			}
			const meta = parseMeta(image.meta);
			const challengeBlock = await challengeArchiveBlockForCreation(image.id, meta, "deleting");
			if (challengeBlock) {
				return res.status(400).json({ error: challengeBlock });
			}
			const status = image.status || "completed";
			if (isCreationGpuInFlight(status) && !isCreationFinishTimedOut(status, meta)) {
				return res.status(400).json({ error: "Cannot delete an in-progress creation" });
			}
			const markResult = await queries.markCreatedImageUnavailable?.run(req.params.id, user.id);
			if (!markResult || markResult.changes === 0) {
				return res.status(500).json({ error: "Failed to delete image" });
			}
			if (queries.deleteFeedItemByCreatedImageId?.run) {
				await queries.deleteFeedItemByCreatedImageId.run(parseInt(req.params.id));
			}
			const supabase = getSupabaseServiceClient();
			if (supabase) {
				try {
					await deleteCreationEmbedding(supabase, parseInt(req.params.id));
				} catch (err) {
					console.warn("[create] Failed to delete embedding on user delete:", err?.message || err);
				}
			}
			return res.json({ success: true, message: "Image deleted successfully" });
		} catch (error) {
			return res.status(500).json({ error: "Failed to delete image" });
		}
	});

function normalizeGroupSourcesCoverFirst(sourceList, coverSourceId) {
		const list = Array.isArray(sourceList)
			? sourceList.filter((item) => item && typeof item === "object")
			: [];
		const coverId = Number(coverSourceId);
		if (!Number.isFinite(coverId) || coverId <= 0) return list;
		const coverIndex = list.findIndex((item) => Number(item.id) === coverId);
		if (coverIndex <= 0) return list;
		const normalized = [...list];
		const [coverSource] = normalized.splice(coverIndex, 1);
		normalized.unshift(coverSource);
		return normalized;
	}

function buildGroupReorderLeftState({
		groupMeta,
		groupPayload,
		sourceCreations,
		sourceId,
		storage,
		fallbackGroupRow
	}) {
		const coverSourceId = Number(groupPayload?.cover_source_id);
		const sourceList = normalizeGroupSourcesCoverFirst(sourceCreations, coverSourceId);
		const index = sourceList.findIndex((item) => Number(item.id) === Number(sourceId));
		if (index <= 0) return null;

		const reordered = [...sourceList];
		[reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
		const reorderedSources = reordered.map((item, orderIndex) => ({ ...item, order: orderIndex }));
		const oldFirstId = Number(sourceList[0]?.id);
		const newCoverId = Number(reorderedSources[0]?.id);

		if (Number.isFinite(newCoverId) && newCoverId > 0 && newCoverId !== oldFirstId) {
			return buildGroupCoverUpdateState({
				groupMeta,
				groupPayload,
				sourceCreations: reorderedSources,
				coverSourceId: newCoverId,
				storage,
				fallbackGroupRow
			});
		}

		const nextMeta = {
			...(groupMeta && typeof groupMeta === "object" ? groupMeta : {}),
			group: {
				...(groupPayload && typeof groupPayload === "object" ? groupPayload : {}),
				updated_at: nowIso(),
				cover_source_id: Number.isFinite(newCoverId) && newCoverId > 0 ? newCoverId : coverSourceId,
				source_creation_ids: reorderedSources
					.map((item) => Number(item.id))
					.filter((n, idx, arr) => Number.isFinite(n) && n > 0 && arr.indexOf(n) === idx),
				source_creations: reorderedSources
			}
		};

		return {
			reorderedSources,
			meta: nextMeta,
			updatePayload: null
		};
	}

router.post("/api/create/images/:id/group-cover", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const groupId = Number(req.params.id);
			const sourceId = Number(req.body?.source_id);
			if (!Number.isFinite(groupId) || groupId <= 0 || !Number.isFinite(sourceId) || sourceId <= 0) {
				return res.status(400).json({ error: "Invalid ids" });
			}
			const groupRow = await queries.selectCreatedImageById.get(groupId, user.id);
			if (!groupRow) {
				return res.status(404).json({ error: "Creation not found" });
			}
			const groupMeta = parseMeta(groupRow.meta) || {};
			const groupPayload = groupMeta?.group && typeof groupMeta.group === "object" ? groupMeta.group : null;
			if (!groupPayload || groupPayload.kind !== "group_creations") {
				return res.status(400).json({ error: "Creation is not a group creation" });
			}
			const sourceCreationsRaw = Array.isArray(groupPayload.source_creations) ? groupPayload.source_creations : [];
			const sourceCreations = sourceCreationsRaw.filter((item) => item && typeof item === "object");
			const coverState = buildGroupCoverUpdateState({
				groupMeta,
				groupPayload,
				sourceCreations,
				coverSourceId: sourceId,
				storage,
				fallbackGroupRow: groupRow
			});
			if (!coverState) {
				return res.status(400).json({ error: "Selected source is not part of this group" });
			}

			const updateResult = await queries.updateCreatedImageGroupCover?.run(
				groupId,
				user.id,
				coverState.updatePayload
			);
			if (!updateResult || updateResult.changes === 0) {
				return res.status(500).json({ error: "Failed to set group cover" });
			}
			const updatedGroup = await queries.selectCreatedImageById.get(groupId, user.id);
			return res.json({
				ok: true,
				grouped_creation: {
					id: updatedGroup?.id ?? groupId,
					created_at: updatedGroup?.created_at ?? coverState.updatePayload.created_at,
					meta: parseMeta(updatedGroup?.meta) || coverState.meta
				}
			});
		} catch (error) {
			return res.status(500).json({ error: "Failed to set group cover" });
		}
	});

router.post("/api/create/images/:id/group-reorder", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const groupId = Number(req.params.id);
			const sourceId = Number(req.body?.source_id);
			if (!Number.isFinite(groupId) || groupId <= 0 || !Number.isFinite(sourceId) || sourceId <= 0) {
				return res.status(400).json({ error: "Invalid ids" });
			}
			const groupRow = await queries.selectCreatedImageById.get(groupId, user.id);
			if (!groupRow) {
				return res.status(404).json({ error: "Creation not found" });
			}
			const isPublished = groupRow.published === 1 || groupRow.published === true;
			if (isPublished) {
				return res.status(400).json({ error: "Published group creations cannot be reordered" });
			}
			const groupMeta = parseMeta(groupRow.meta) || {};
			const groupPayload = groupMeta?.group && typeof groupMeta.group === "object" ? groupMeta.group : null;
			if (!groupPayload || groupPayload.kind !== "group_creations") {
				return res.status(400).json({ error: "Creation is not a group creation" });
			}
			const sourceCreationsRaw = Array.isArray(groupPayload.source_creations) ? groupPayload.source_creations : [];
			const sourceCreations = sourceCreationsRaw.filter((item) => item && typeof item === "object");
			const reorderState = buildGroupReorderLeftState({
				groupMeta,
				groupPayload,
				sourceCreations,
				sourceId,
				storage,
				fallbackGroupRow: groupRow
			});
			if (!reorderState) {
				return res.status(400).json({ error: "Selected source cannot be moved left" });
			}

			if (reorderState.updatePayload) {
				const updateResult = await queries.updateCreatedImageGroupCover?.run(
					groupId,
					user.id,
					reorderState.updatePayload
				);
				if (!updateResult || updateResult.changes === 0) {
					return res.status(500).json({ error: "Failed to reorder group sources" });
				}
			} else {
				const metaResult = await queries.updateCreatedImageMeta.run(groupId, user.id, reorderState.meta);
				if (!metaResult || metaResult.changes === 0) {
					return res.status(500).json({ error: "Failed to reorder group sources" });
				}
			}

			const updatedGroup = await queries.selectCreatedImageById.get(groupId, user.id);
			return res.json({
				ok: true,
				grouped_creation: {
					id: updatedGroup?.id ?? groupId,
					created_at: updatedGroup?.created_at ?? groupRow.created_at,
					meta: parseMeta(updatedGroup?.meta) || reorderState.meta
				}
			});
		} catch (error) {
			return res.status(500).json({ error: "Failed to reorder group sources" });
		}
	});

router.post("/api/create/images/:id/ungroup", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const groupId = Number(req.params.id);
			if (!Number.isFinite(groupId) || groupId <= 0) {
				return res.status(400).json({ error: "Invalid creation id" });
			}
			const groupRow = await queries.selectCreatedImageById.get(groupId, user.id);
			if (!groupRow) {
				return res.status(404).json({ error: "Creation not found" });
			}
			const isPublished = groupRow.published === 1 || groupRow.published === true;
			if (isPublished) {
				return res.status(400).json({ error: "Published group creations cannot be ungrouped" });
			}
			const groupMeta = parseMeta(groupRow.meta) || {};
			if (isGroupV2Meta(groupMeta)) {
				return res.status(400).json({ error: groupV2RejectMessage("ungroup") });
			}
			const groupPayload = groupMeta?.group && typeof groupMeta.group === "object" ? groupMeta.group : null;
			if (!groupPayload || groupPayload.kind !== "group_creations") {
				return res.status(400).json({ error: "Creation is not a group creation" });
			}
			const sourceIdsRaw = Array.isArray(groupPayload.source_creation_ids) ? groupPayload.source_creation_ids : [];
			const sourceIds = sourceIdsRaw
				.map((v) => Number(v))
				.filter((n, index, arr) => Number.isFinite(n) && n > 0 && arr.indexOf(n) === index);
			if (sourceIds.length === 0) {
				return res.status(400).json({ error: "Group creation has no source creations to restore" });
			}

			for (const sourceId of sourceIds) {
				const sourceRow = await queries.selectCreatedImageByIdAnyUser?.get(sourceId);
				if (!sourceRow || Number(sourceRow.user_id) !== Number(user.id)) {
					return res.status(400).json({ error: "Unable to restore source creations for this group" });
				}
				const sourcePublished = sourceRow.published === 1 || sourceRow.published === true;
				if (sourcePublished) {
					return res.status(400).json({ error: "Cannot ungroup because one source creation is published" });
				}
			}

			for (const sourceId of sourceIds) {
				const restoreResult = await queries.unmarkCreatedImageUnavailable?.run(sourceId, user.id);
				if (!restoreResult || restoreResult.changes === 0) {
					return res.status(500).json({ error: "Failed to restore source creations" });
				}
			}

			const markGroupUnavailable = await queries.markCreatedImageUnavailable?.run(groupId, user.id);
			if (!markGroupUnavailable || markGroupUnavailable.changes === 0) {
				return res.status(500).json({ error: "Failed to archive grouped creation" });
			}

			return res.json({ ok: true, restored_creation_ids: sourceIds });
		} catch (error) {
			return res.status(500).json({ error: "Failed to ungroup creation" });
		}
	});


}
