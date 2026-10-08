import { registerCreationLibraryRoutes } from './creationLibrary.js';
import express from "express";
import path from "path";

import Busboy from "busboy";

import { appendCreationIdToMediaUrl, getThumbnailUrl, getShareBaseUrl } from "../services/create/url.js";

import { buildProviderHeaders } from "../services/create/providerAuth.js";
import { runCreationJob, runProviderPollJob, healProviderPollOnRead, PROVIDER_TIMEOUT_MS } from "../services/create/creationJob.js";
import {
	isCreationFinishTimedOut,
	isCreationGpuInFlight,
} from "../services/create/creationGpuWait.js";
import { runLandscapeJob } from "../services/create/landscapeJob.js";
import { scheduleCreationJob } from "../services/create/scheduleCreationJob.js";

import { runAudioCoverJob } from "../services/create/audioCoverGenerate.js";


import { materializeBlueProviderAudioArgs, resolveAudioProviderArgs } from "../services/create/audioClips.js";
import { creationMethodIsAudio, resolveVoiceFileForProvider } from "../services/create/persistGeneratedAudio.js";

import { getSupabaseServiceClient } from "../services/create/supabaseService.js";
import { verifyQStashRequest } from "../services/create/qstashVerification.js";
import { creationIdFromParasceneVideoUrl, resolveCreatedImageRowForProviderImageUrl } from "../services/create/resolveCreatedImageStorageFilename.js";

import { mapCreatedImageRowMediaFields } from "../services/create/resolveCreationDisplayMedia.js";
import { applyCostumeToCreationPayload, isGroupV2Meta, isHiddenInGroupMeta, wantsRawGroupV2 } from "../services/create/projectGroupV2.js";
import {
	appendCreationToOwnedGroupV2,
	fillThinGroupV2ItemViews,
	resolveOwnedGroupV2Id,
} from "../services/create/groupV2Ops.js";

import { parseAspectRatioString } from "../client/shared/aspectRatio.js";
import { normalizeEditedUploadBuffer } from "../services/create/editedImageUpload.js";
import { ACTIVE_SHARE_VERSION, mintShareToken } from "./utils/shareLink.js";
import { getStyleInfo } from "../services/create/createStyles.js";
import { PARASCENE_BLUE_SERVER_ID } from "../client/shared/generationDefaults.js";
import { resolveProductNamedPrice } from "../client/shared/gpuOccupancy.js";
import { importSunoCreation, previewSunoImport } from "../services/create/importSunoCreation.js";
import { importYoutubeCreation, previewYoutubeImport, refreshYoutubeImportCover } from "../services/create/importYoutubeCreation.js";
import { finalizeAudioFileImport, startAudioFileImport } from "../services/create/importAudioFileCreation.js";
import {
	finalizeEphemeralStill,
	mintEphemeralStillFetch,
	startEphemeralStill,
	resolveEphemeralStillProviderArgs,
} from "../services/create/importEphemeralStill.js";

import { applyPickerStyleModifiersToPrompt, expandStyleSigilsForProvider, extractStyleSigilTokens, resolveStyleModifiersForPicker } from "../services/create/styleSigils.js";







import { computeChallengeEndedByImageId } from "../services/create/challengeSubmitShared.js";







import { healChallengeOrganizerRefsForCreationList } from "../services/create/challengeOrganizerRefSync.js";

import { applySourceShareUrlToMutateArgsWhenMatching } from "../services/create/mutateLineageImageUrl.js";
import { buildMutateLineageMetaFields } from "../services/create/mutateLineageMeta.js";
import { bumpFeedVersionCounter } from "../services/feed/feedVersion.js";
import { invalidateFeedBetaCatalogSnapshot } from "../services/feed/ranking/catalogSnapshot.js";
function buildGenericUrl(key) {
	const segments = String(key || "")
		.split("/")
		.filter(Boolean)
		.map((seg) => encodeURIComponent(seg));
	return `/api/images/generic/${segments.join("/")}`;
}
function parseMultipartCreate(req, { maxFileBytes = 50 * 1024 * 1024 } = {}) {
	return new Promise((resolve, reject) => {
		const busboy = Busboy({ headers: req.headers, limits: { fileSize: maxFileBytes, files: 1, fields: 20 } });
		const fields = {};
		const files = {};
		busboy.on("field", (name, value) => {
			fields[name] = value;
		});
		busboy.on("file", (name, file, info) => {
			const chunks = [];
			let total = 0;
			file.on("data", (data) => {
				total += data.length;
				chunks.push(data);
			});
			file.on("limit", () => reject(new Error("File too large")));
			file.on("end", () => {
				if (total > 0) {
					files[name] = { buffer: Buffer.concat(chunks), mimeType: info?.mimeType || "application/octet-stream" };
				}
			});
		});
		busboy.on("error", reject);
		busboy.on("finish", () => resolve({ fields, files }));
		req.pipe(busboy);
	});
}
function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }

export default function createCreateRoutes({ queries, storage, canUseServer }) {
const router = express.Router();
 router.use('/api/create', asyncRoute(async (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'POST' && ['/', '/query', '/preview'].includes(req.path) && req.body?.server_id) {
   if (!req.auth?.userId) return res.status(401).json({ error: 'Unauthorized' });
   if (!(await canUseServer(req.auth.userId, Number(req.body.server_id)))) return res.status(403).json({ error: 'Server access denied' });
  }
  next();
 }));
async function requireUser(req, res) {
		if (!req.auth?.userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}

		const user = await queries.selectUserById.get(req.auth.userId);
		if (!user) {
			res.status(404).json({ error: "User not found" });
			return null;
		}

		return user;
	}
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
function characterFromPersonaRow(row) {
		if (!row) return "";
		const pMeta = parseMeta(row.meta) || {};
		const fromInj = typeof row.injection_text === "string" ? row.injection_text.trim() : "";
		const fromMeta =
			typeof pMeta.character_description === "string" ? pMeta.character_description.trim() : "";
		return fromInj || fromMeta;
	}
async function resolveCastTextForMentionTag(userId, normalized) {
		if (!queries.selectUserProfileByUsername?.get) {
			return { ok: false, reason: "profiles_unavailable" };
		}
		const profile = await queries.selectUserProfileByUsername.get(normalized);
		if (profile) {
			const uMeta = parseMeta(profile.meta) || {};
			const cd =
				typeof uMeta.character_description === "string" ? uMeta.character_description.trim() : "";
			if (!cd) return { ok: false, reason: "no_character_description" };
			return { ok: true, text: cd };
		}
		const personaGet = queries.selectPersonaPromptInjectionInLibraryForUserByTag?.get;
		if (typeof personaGet === "function") {
			const personaRow = await personaGet(userId, normalized);
			if (personaRow) {
				const cd = characterFromPersonaRow(personaRow);
				if (!cd) return { ok: false, reason: "no_character_description" };
				return { ok: true, text: cd };
			}
		}
		return { ok: false, reason: "mention_not_found" };
	}
function collectGroupSourceCreationIds(groupPayload) {
		const ids = new Set();
		if (!groupPayload || typeof groupPayload !== "object") return ids;
		const rawIds = Array.isArray(groupPayload.source_creation_ids) ? groupPayload.source_creation_ids : [];
		for (const id of rawIds) {
			const n = Number(id);
			if (Number.isFinite(n) && n > 0) ids.add(n);
		}
		const sourceCreations = Array.isArray(groupPayload.source_creations) ? groupPayload.source_creations : [];
		for (const source of sourceCreations) {
			const n = Number(source?.id);
			if (Number.isFinite(n) && n > 0) ids.add(n);
		}
		const coverSourceId = Number(groupPayload.cover_source_id);
		if (Number.isFinite(coverSourceId) && coverSourceId > 0) ids.add(coverSourceId);
		return ids;
	}
function isGroupSourceOfSharedCreation(groupRow, ancestorId) {
		const meta = parseMeta(groupRow?.meta);
		const groupPayload = meta?.group && typeof meta.group === "object" ? meta.group : null;
		if (groupPayload?.kind !== "group_creations") return false;
		return collectGroupSourceCreationIds(groupPayload).has(Number(ancestorId));
	}
function findGroupSourceSnapshot(groupPayload, sourceId) {
		const sid = Number(sourceId);
		if (!groupPayload || typeof groupPayload !== "object" || !Number.isFinite(sid) || sid <= 0) {
			return null;
		}
		const sources = Array.isArray(groupPayload.source_creations) ? groupPayload.source_creations : [];
		return sources.find((s) => s && typeof s === "object" && Number(s.id) === sid) || null;
	}
async function buildGroupMutateSourcePayload({ groupRow, sourceId, viewerUser }) {
		if (!groupRow || !viewerUser) return null;
		const groupId = Number(groupRow.id);
		const sid = Number(sourceId);
		if (!Number.isFinite(groupId) || groupId <= 0 || !Number.isFinite(sid) || sid <= 0) return null;
		if (!viewerOwnsCreationRow(groupRow, viewerUser.id) && viewerUser.role !== "admin") return null;
		if (!isGroupSourceOfSharedCreation(groupRow, sid)) return null;

		const groupMeta = parseMeta(groupRow.meta);
		const groupPayload = groupMeta?.group && typeof groupMeta.group === "object" ? groupMeta.group : null;
		const snap = findGroupSourceSnapshot(groupPayload, sid);

		let sourceRow = null;
		try {
			sourceRow = await queries.selectCreatedImageByIdAnyUser?.get(sid);
		} catch {
			sourceRow = null;
		}

		const status = sourceRow?.status || snap?.status || "completed";
		if (status !== "completed") return { error: "not_ready" };

		let filename =
			typeof snap?.filename === "string" && snap.filename.trim() && !snap.filename.startsWith("group/")
				? snap.filename.trim()
				: "";
		if (!filename && sourceRow?.filename) {
			const fn = String(sourceRow.filename).trim();
			if (fn && !fn.startsWith("group/")) filename = fn;
		}

		let filePath = typeof snap?.file_path === "string" ? snap.file_path.trim() : "";
		if (!filePath && sourceRow?.file_path) filePath = String(sourceRow.file_path).trim();

		let rawUrl = filePath || (filename ? storage.getImageUrl(filename) : null);
		if (!rawUrl) return null;

		const url = appendCreationIdToMediaUrl(rawUrl, groupId);

		const title =
			(typeof snap?.title === "string" && snap.title.trim()) ||
			(typeof sourceRow?.title === "string" && sourceRow.title.trim()) ||
			"Untitled";
		const isPublished = sourceRow
			? sourceRow.published === 1 || sourceRow.published === true
			: false;
		const sourceUserId = sourceRow?.user_id ?? snap?.user_id ?? null;

		let creator = null;
		if (sourceUserId) {
			const creatorUser = await queries.selectUserById.get(sourceUserId).catch(() => null);
			const creatorProfile = await queries.selectUserProfileByUserId
				.get(sourceUserId)
				.catch(() => null);
			if (creatorUser) {
				creator = {
					id: creatorUser.id,
					email: creatorUser.email,
					role: creatorUser.role,
					user_name: creatorProfile?.user_name ?? null,
					display_name: creatorProfile?.display_name ?? null,
					avatar_url: creatorProfile?.avatar_url ?? null,
					plan: creatorUser.meta?.plan === "founder" ? "founder" : "free"
				};
			}
		}

		const snapMeta = snap?.meta && typeof snap.meta === "object" ? snap.meta : null;
		const sourceMeta = sourceRow?.meta ? parseMeta(sourceRow.meta) : snapMeta;
		const mediaType =
			typeof sourceMeta?.media_type === "string"
				? sourceMeta.media_type
				: typeof snapMeta?.media_type === "string"
					? snapMeta.media_type
					: "image";

		return {
			id: sid,
			group_id: groupId,
			filename: filename || sourceRow?.filename || null,
			url,
			thumbnail_url: url ? getThumbnailUrl(url) : null,
			width: sourceRow?.width ?? snap?.width ?? null,
			height: sourceRow?.height ?? snap?.height ?? null,
			status: "completed",
			published: isPublished,
			title,
			user_id: sourceUserId,
			meta: sourceMeta,
			media_type: mediaType,
			mutate_of_id: sid,
			creator
		};
	}
function viewerOwnsCreationRow(row, viewerUserId) {
		if (!row || viewerUserId == null) return false;
		return Number(row.user_id) === Number(viewerUserId);
	}
function parsePositiveIntQuery(value) {
		const n = typeof value === "string" ? parseInt(value, 10) : Number(value);
		return Number.isFinite(n) && n > 0 ? n : null;
	}
async function selectOwnedGroupRow(groupId, viewerUserId) {
		const gid = Number(groupId);
		if (!Number.isFinite(gid) || gid <= 0) return null;
		const owned = await queries.selectCreatedImageById.get(gid, viewerUserId);
		if (owned) return owned;
		const any = await queries.selectCreatedImageByIdAnyUser?.get(gid);
		if (any && viewerOwnsCreationRow(any, viewerUserId)) return any;
		return null;
	}
function isModeratedError(status, meta) {
		if (status !== "failed" || meta == null) return false;
		try {
			const parts = [];
			if (typeof meta.error === "string" && meta.error.trim()) parts.push(meta.error.trim());
			const pe = meta.provider_error;
			if (pe != null && typeof pe === "object" && pe.body != null) {
				const b = pe.body;
				if (typeof b === "string") parts.push(b.trim());
				else if (typeof b === "object") {
					if (typeof b.error === "string" && b.error.trim()) parts.push(b.error.trim());
					else if (typeof b.message === "string" && b.message.trim()) parts.push(b.message.trim());
				}
			}
			const errorText = parts.join(" ").toLowerCase();
			return errorText.length > 0 && (errorText.includes("moderated") || errorText.includes("flagged as sensitive"));
		} catch {
			return false;
		}
	}
function nowIso() {
		return new Date().toISOString();
	}
const providerBase = getShareBaseUrl();
function toParasceneImageUrl(raw) {
		const base = providerBase;
		if (typeof raw !== "string") return null;
		const value = raw.trim();
		if (!value) return null;
		try {
			const parsed = new URL(value, base);
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
			return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
		} catch {
			return null;
		}
	}
function shareUrlForImage(imageId, sharedByUserId) {
		const id = Number(imageId);
		const uid = Number(sharedByUserId);
		if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(uid) || uid <= 0) return null;
		try {
			const token = mintShareToken({
				version: ACTIVE_SHARE_VERSION,
				imageId: id,
				sharedByUserId: uid
			});
			return `${providerBase}/api/share/${encodeURIComponent(ACTIVE_SHARE_VERSION)}/${encodeURIComponent(token)}/image`;
		} catch {
			return null;
		}
	}
function shareUrlForVideo(imageId, sharedByUserId) {
		const imageUrl = shareUrlForImage(imageId, sharedByUserId);
		if (!imageUrl) return null;
		return imageUrl.endsWith("/image")
			? `${imageUrl.slice(0, -"/image".length)}/video`
			: imageUrl.replace(/\/image$/, "/video");
	}
const ADVANCED_DATA_BUILDER_KEYS = ["recent_comments", "recent_posts", "top_likes", "bottom_likes", "most_mutated"];
function getAdvancedExtraArgs(args) {
		if (!args || typeof args !== "object") return {};
		const extra = {};
		for (const [k, v] of Object.entries(args)) {
			if (ADVANCED_DATA_BUILDER_KEYS.includes(k)) continue;
			extra[k] = v;
		}
		return extra;
	}
function buildCreationMetaSubset(meta) {
		const m = parseMeta(meta);
		if (!m || typeof m !== "object") return null;
		const out = {};
		if (m.args != null && typeof m.args === "object" && !Array.isArray(m.args)) {
			out.args = m.args;
		}
		if (typeof m.method_name === "string" && m.method_name.trim()) {
			out.method_name = m.method_name.trim();
		}
		if (typeof m.server_name === "string" && m.server_name.trim()) {
			out.server_name = m.server_name.trim();
		}
		if (Array.isArray(m.history) && m.history.length > 0) {
			out.history = m.history.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
		}
		if (m.mutate_of_id != null && Number.isFinite(Number(m.mutate_of_id)) && Number(m.mutate_of_id) > 0) {
			out.mutate_of_id = Number(m.mutate_of_id);
		}
		return Object.keys(out).length === 0 ? null : out;
	}
async function buildAdvancedItems(userId, options) {
		const recent_comments = options?.recent_comments === true;
		const recent_posts = options?.recent_posts === true;
		const top_likes = options?.top_likes === true;
		const bottom_likes = options?.bottom_likes === true;
		const most_mutated = options?.most_mutated === true;
		const selectedOptions = [recent_comments && 'recent_comments', recent_posts && 'recent_posts', top_likes && 'top_likes', bottom_likes && 'bottom_likes', most_mutated && 'most_mutated'].filter(Boolean);
		if (selectedOptions.length === 0) return [];
		const MAX_ITEMS = 100;
		const perOptionLimit = Math.floor(MAX_ITEMS / selectedOptions.length);
		const items = [];

		if (recent_comments && queries.selectLatestCreatedImageComments?.all) {
			const comments = await queries.selectLatestCreatedImageComments.all({ limit: perOptionLimit });
			for (const comment of (comments || []).slice(0, perOptionLimit)) {
				const imageId = comment?.created_image_id || null;
				const imageUrl = shareUrlForImage(imageId, userId) ?? null;
				items.push({
					type: 'comment',
					source: 'recent_comments',
					id: comment?.id,
					text: comment?.text || '',
					created_at: comment?.created_at,
					author: comment?.user_name || comment?.display_name || null,
					image_url: imageUrl,
					image_id: imageId,
					image_title: comment?.created_image_title || null
				});
			}
		}
		if (recent_posts && queries.selectNewestPublishedFeedItems?.all) {
			const feedItems = await queries.selectNewestPublishedFeedItems.all(userId);
			for (const item of (feedItems || []).slice(0, perOptionLimit)) {
				const imageId = item?.created_image_id || null;
				const imageUrl = shareUrlForImage(imageId, userId) ?? null;
				items.push({
					type: 'post',
					source: 'recent_posts',
					id: item?.id,
					title: item?.title || '',
					summary: item?.summary || '',
					created_at: item?.created_at,
					author: item?.author_display_name || item?.author_user_name || item?.author || null,
					image_url: imageUrl,
					image_id: imageId,
					like_count: Number(item?.like_count || 0),
					comment_count: Number(item?.comment_count || 0)
				});
			}
		}
		if (top_likes && queries.selectNewestPublishedFeedItems?.all) {
			const feedItems = await queries.selectNewestPublishedFeedItems.all(userId) || [];
			const sorted = [...feedItems].filter(i => i?.like_count !== undefined).sort((a, b) => Number(b?.like_count || 0) - Number(a?.like_count || 0)).slice(0, perOptionLimit);
			for (const item of sorted) {
				const imageId = item?.created_image_id || item?.id || null;
				const imageUrl = shareUrlForImage(imageId, userId) ?? null;
				items.push({
					type: 'image',
					source: 'top_likes',
					id: imageId,
					title: item?.title || '',
					summary: item?.summary || '',
					created_at: item?.created_at,
					author: item?.author_display_name || item?.author_user_name || item?.author || null,
					image_url: imageUrl,
					like_count: Number(item?.like_count || 0),
					comment_count: Number(item?.comment_count || 0)
				});
			}
		}
		if (bottom_likes && queries.selectNewestPublishedFeedItems?.all) {
			const feedItems = await queries.selectNewestPublishedFeedItems.all(userId) || [];
			const sorted = [...feedItems].filter(i => i?.like_count !== undefined).sort((a, b) => Number(a?.like_count || 0) - Number(b?.like_count || 0)).slice(0, perOptionLimit);
			for (const item of sorted) {
				const imageId = item?.created_image_id || item?.id || null;
				const imageUrl = shareUrlForImage(imageId, userId) ?? null;
				items.push({
					type: 'image',
					source: 'bottom_likes',
					id: imageId,
					title: item?.title || '',
					summary: item?.summary || '',
					created_at: item?.created_at,
					author: item?.author_display_name || item?.author_user_name || item?.author || null,
					image_url: imageUrl,
					like_count: Number(item?.like_count || 0),
					comment_count: Number(item?.comment_count || 0)
				});
			}
		}
		if (most_mutated && queries.selectAllCreatedImageIdAndMeta?.all && queries.selectFeedItemsByCreationIds?.all) {
			const idMetaRows = await queries.selectAllCreatedImageIdAndMeta.all().catch(() => []) ?? [];
			const countById = new Map();
			function toHistoryArray(raw) {
				const h = raw?.history;
				if (Array.isArray(h)) return h;
				if (typeof h === "string") {
					try { const a = JSON.parse(h); return Array.isArray(a) ? a : []; } catch { return []; }
				}
				return [];
			}
			for (const row of idMetaRows) {
				const meta = parseMeta(row?.meta);
				if (!meta || typeof meta !== "object") continue;
				const history = toHistoryArray(meta);
				for (const v of history) {
					const id = v != null ? Number(v) : NaN;
					if (!Number.isFinite(id) || id <= 0) continue;
					countById.set(id, (countById.get(id) ?? 0) + 1);
				}
				const mid = meta.mutate_of_id != null ? Number(meta.mutate_of_id) : NaN;
				if (Number.isFinite(mid) && mid > 0) countById.set(mid, (countById.get(mid) ?? 0) + 1);
			}
			const topIds = [...countById.entries()]
				.sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))
				.slice(0, perOptionLimit)
				.map(([id]) => id);
			const feedItems = topIds.length > 0
				? (await queries.selectFeedItemsByCreationIds.all(topIds).catch(() => []) ?? [])
				: [];
			for (const item of feedItems.slice(0, perOptionLimit)) {
				const imageId = item?.created_image_id ?? item?.id ?? null;
				const imageUrl = shareUrlForImage(imageId, userId) ?? null;
				items.push({
					type: 'image',
					source: 'most_mutated',
					id: imageId,
					title: item?.title || '',
					summary: item?.summary || '',
					created_at: item?.created_at,
					author: item?.author_display_name || item?.author_user_name || item?.author || null,
					image_url: imageUrl,
					like_count: Number(item?.like_count || 0),
					comment_count: Number(item?.comment_count || 0)
				});
			}
		}

		const trimmed = items.slice(0, MAX_ITEMS);
		const imageIds = [...new Set(
			trimmed
				.map((it) => it.image_id != null ? it.image_id : it.id)
				.filter((id) => id != null && Number.isFinite(Number(id)) && Number(id) > 0)
		)];
		if (imageIds.length === 0) return trimmed;

		const descriptionAndMetaRows = await queries.selectCreatedImageDescriptionAndMetaByIds?.all(imageIds).catch(() => []) ?? [];
		const byId = new Map();
		for (const row of descriptionAndMetaRows) {
			const id = row?.id != null ? Number(row.id) : null;
			if (id == null || !Number.isFinite(id)) continue;
			const description = typeof row.description === "string" ? row.description.trim() || null : null;
			const creation_meta = buildCreationMetaSubset(row.meta);
			byId.set(id, { description, creation_meta });
		}

		for (const it of trimmed) {
			const imageId = it.image_id != null ? it.image_id : it.id;
			const id = imageId != null ? Number(imageId) : null;
			if (id == null) continue;
			const info = byId.get(id);
			if (info) {
				if (info.description != null) it.description = info.description;
				if (info.creation_meta != null) it.creation_meta = info.creation_meta;
			}
		}

		return trimmed;
	}
router.post("/api/create/preview", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		// Accept args from req.body.args or, if missing, from req.body (so clients can send { most_mutated: true } or { args: { most_mutated: true } })
		const raw = (req.body && typeof req.body === "object" && req.body.args != null && typeof req.body.args === "object")
			? req.body.args
			: (req.body && typeof req.body === "object" ? req.body : {});
		const safeArgs = { ...raw };
		// Normalize Data Builder booleans so string "true" is treated as true
		for (const k of ADVANCED_DATA_BUILDER_KEYS) {
			if (safeArgs[k] === "true" || safeArgs[k] === true) safeArgs[k] = true;
			else if (safeArgs[k] === "false" || safeArgs[k] === false) safeArgs[k] = false;
		}

		try {
			const items = await buildAdvancedItems(user.id, safeArgs);
			const extraArgs = getAdvancedExtraArgs(safeArgs);
			if (typeof extraArgs.prompt === "string") {
				const expanded = await expandStyleSigilsForProvider(queries, user.id, extraArgs.prompt);
				if (!expanded.ok) {
					return res.status(400).json({
						error: "Invalid style references",
						failed_styles: expanded.failed_styles
					});
				}
				extraArgs.prompt = expanded.providerPrompt;
			}
			const clipResolved = await resolveAudioProviderArgs(
				queries,
				user.id,
				extraArgs,
				getShareBaseUrl()
			);
			if (!clipResolved.ok) {
				return res.status(clipResolved.status).json({
					error: clipResolved.error,
					message: clipResolved.error,
					code: clipResolved.code || "audio_resolve_failed"
				});
			}
			const providerArgs = { items, ...clipResolved.args };
			const payload = { method: "advanced_query", args: providerArgs };
			return res.json({ payload });
		} catch (err) {
			return res.status(500).json({
				error: "Preview failed",
				message: err?.message || "Failed to build payload"
			});
		}
	}));
router.post("/api/create/query", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const { server_id, args, method } = req.body;
		const safeArgs = args && typeof args === "object" ? { ...args } : {};
		const methodKey = typeof method === "string" ? method.trim() : "";

		if (!server_id) {
			return res.status(400).json({ error: "Missing required fields", message: "server_id is required" });
		}

		try {
			const server = await queries.selectServerById.get(server_id);
			if (!server) return res.status(404).json({ error: "Server not found" });
			if (server.status !== "active") return res.status(400).json({ error: "Server is not active" });

			let providerPayload;
			if (methodKey) {
				providerPayload = {
					method: "query",
					args: { method: methodKey, ...safeArgs }
				};
			} else {
				const items = await buildAdvancedItems(user.id, safeArgs);
				const extraArgs = getAdvancedExtraArgs(safeArgs);
				if (typeof extraArgs.prompt === "string") {
					const expanded = await expandStyleSigilsForProvider(queries, user.id, extraArgs.prompt);
					if (!expanded.ok) {
						return res.status(400).json({
							error: "Invalid style references",
							failed_styles: expanded.failed_styles
						});
					}
					extraArgs.prompt = expanded.providerPrompt;
				}
				const clipResolved = await resolveAudioProviderArgs(
					queries,
					user.id,
					extraArgs,
					getShareBaseUrl()
				);
				if (!clipResolved.ok) {
					return res.status(clipResolved.status).json({
						error: clipResolved.error,
						message: clipResolved.error,
						code: clipResolved.code || "audio_resolve_failed"
					});
				}
				providerPayload = {
					method: "advanced_query",
					args: { items, ...clipResolved.args }
				};
			}

			const providerResponse = await fetch(server.server_url, {
				method: "POST",
				headers: buildProviderHeaders(
					{ "Content-Type": "application/json", Accept: "application/json" },
					server.auth_token,
					server.server_config?.custom_headers
				),
				body: JSON.stringify(providerPayload),
				signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
			});

			const contentType = String(providerResponse.headers.get("content-type") || "").toLowerCase();
			let body = null;
			if (contentType.includes("application/json")) {
				body = await providerResponse.json().catch(() => null);
			} else {
				const text = await providerResponse.text().catch(() => "");
				return res.status(502).json({
					error: "Invalid provider response",
					message: "Server did not return JSON"
				});
			}

			if (!providerResponse.ok) {
				return res.status(502).json({
					error: "Provider error",
					message: body?.error || body?.message || providerResponse.statusText,
					provider: body
				});
			}

			return res.json(body);
		} catch (err) {
			if (err?.name === "AbortError") {
				return res.status(504).json({ error: "Timeout", message: "Server did not respond in time" });
			}
			return res.status(500).json({
				error: "Query failed",
				message: err?.message || "Failed to query server"
			});
		}
	}));
router.post("/api/create/validate", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const rawArgs = req.body && typeof req.body === "object"
				? (req.body.args && typeof req.body.args === "object" ? req.body.args : req.body)
				: {};
			const prompt = typeof rawArgs?.prompt === "string" ? rawArgs.prompt : "";

			const normalizeUsername = (input) => {
				const raw = typeof input === "string" ? input.trim() : "";
				if (!raw) return null;
				const normalized = raw.toLowerCase();
				if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) return null;
				return normalized;
			};

			const mentions = [];
			const seen = new Set();
			const re = /@([a-zA-Z0-9_]+)/g;
			let match;
			while ((match = re.exec(prompt)) !== null) {
				const token = match[1] || "";
				const originalMention = `@${token}`;
				const normalized = normalizeUsername(token);
				const key = normalized ? `@${normalized}` : originalMention;
				if (seen.has(key)) continue;
				seen.add(key);
				mentions.push({ originalMention, normalized });
			}

			const failed_mentions = [];
			for (const m of mentions) {
				if (!m.normalized) {
					failed_mentions.push({ mention: m.originalMention, reason: "invalid_username" });
					continue;
				}
				const resolved = await resolveCastTextForMentionTag(user.id, m.normalized);
				if (!resolved.ok) {
					failed_mentions.push({ mention: `@${m.normalized}`, reason: resolved.reason });
				}
			}

			const failed_styles = [];
			if (extractStyleSigilTokens(prompt).length > 0) {
				const expanded = await expandStyleSigilsForProvider(queries, user.id, prompt);
				if (!expanded.ok) {
					for (const row of expanded.failed_styles || []) {
						failed_styles.push(row);
					}
				}
			}

			if (failed_mentions.length > 0 || failed_styles.length > 0) {
				const error =
					failed_styles.length > 0 ? "Invalid style references" : "Invalid mentions";
				const message =
					failed_styles.length > 0
						? (failed_styles || [])
							.map((f) => `${f.token} (${f.reason})`)
							.join(", ")
						: failed_mentions.map((f) => `${f.mention} (${f.reason})`).join(", ");
				return res.status(400).json({
					error,
					message,
					failed_mentions,
					failed_styles
				});
			}

			return res.json({
				ok: true,
				valid: true,
				failed_mentions: [],
				failed_styles: []
			});
		} catch {
			return res.status(500).json({
				error: "Validation failed",
				message: "Validation endpoint encountered an unexpected error."
			});
		}
	}));
router.post("/api/create", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		if (req.is("multipart/form-data")) {
			try {
				const { fields, files } = await parseMultipartCreate(req);
				const args = typeof fields.args === "string" ? (() => {
					try {
						return JSON.parse(fields.args);
					} catch {
						return {};
					}
				})() : (fields.args && typeof fields.args === "object" ? fields.args : {});
				if (files.image_file?.buffer) {
					const aspectRaw =
						typeof args?.aspect_ratio === "string" && parseAspectRatioString(args.aspect_ratio)
							? args.aspect_ratio.trim()
							: null;
					let imgBuf = await normalizeEditedUploadBuffer(files.image_file.buffer, aspectRaw);
					const now = Date.now();
					const rand = Math.random().toString(36).slice(2, 9);
					const userPart = String(user.id).replace(/[^a-z0-9._-]/gi, "_").slice(0, 80);
					const key = `edited/${userPart}/${now}_${rand}.png`;
					if (storage?.uploadGenericImage) {
						await storage.uploadGenericImage(imgBuf, key, { contentType: "image/png" });
						args.image_url = buildGenericUrl(key);
					}
				}
				req.body = {
					server_id: fields.server_id,
					method: fields.method,
					args,
					creation_token: fields.creation_token,
					retry_of_id: fields.retry_of_id,
					mutate_of_id: fields.mutate_of_id,
					mutate_parent_ids: fields.mutate_parent_ids,
					credit_cost: fields.credit_cost,
					hydrate_mentions: fields.hydrate_mentions,
					style_key: fields.style_key
				};
			} catch (err) {
				if (err?.code === "FILE_TOO_LARGE" || err?.message === "File too large") {
					return res.status(413).json({ error: "Image too large" });
				}
				return res.status(400).json({ error: "Invalid multipart body", message: err?.message || "Bad request" });
			}
		}

		const {
			server_id,
			method,
			args,
			creation_token,
			retry_of_id,
			mutate_of_id,
			mutate_parent_ids,
			credit_cost: bodyCreditCost,
			hydrate_mentions,
			style_key,
			group_id: bodyGroupId,
			group_of: bodyGroupOf
		} = req.body;
		const requestedGroupId = parsePositiveIntQuery(bodyGroupId ?? bodyGroupOf);
		const resolvedGroup = await resolveOwnedGroupV2Id(queries, user.id, requestedGroupId);
		if (resolvedGroup.error) {
			return res.status(resolvedGroup.status || 404).json({ error: resolvedGroup.error });
		}
		const v2GroupId = resolvedGroup.groupId;
		const safeArgs = args && typeof args === "object" ? { ...args } : {};
		const hydrateMentions = hydrate_mentions === true || hydrate_mentions === "true" || hydrate_mentions === 1 || hydrate_mentions === "1";

		// Validate required fields
		if (!server_id || !method) {
			return res.status(400).json({
				error: "Missing required fields",
				message: "server_id and method are required"
			});
		}

		if (typeof creation_token !== "string" || creation_token.trim().length < 10) {
			return res.status(400).json({
				error: "Missing required fields",
				message: "creation_token is required"
			});
		}


  // Multipart requests acquire their server id after the JSON middleware has run.
  if (!(await canUseServer(user.id, Number(server_id)))) return res.status(403).json({ error: 'Server access denied' });
  let chargedAmount = 0;
  let admittedCreationId = null;
  let jobScheduled = false;
		try {
			// Fetch server
			const server = await queries.selectServerById.get(server_id);
			if (!server) {
				return res.status(404).json({ error: "Server not found" });
			}

			if (server.status !== 'active') {
				return res.status(400).json({ error: "Server is not active" });
			}

			const isAdvancedGenerate = method === "advanced_generate";
			let methodConfig = null;
			let CREATION_CREDIT_COST = 0.5;
			let argsForProvider = safeArgs;
			// For advanced_generate, backend builds items from boolean args; we store/send { items, ...extra } to provider
			if (isAdvancedGenerate) {
				const cost = Number(bodyCreditCost);
				if (!Number.isFinite(cost) || cost <= 0) {
					return res.status(400).json({
						error: "Missing required fields",
						message: "credit_cost is required for advanced_generate and must be a positive number"
					});
				}
				CREATION_CREDIT_COST = cost;
				methodConfig = { name: "Advanced generate", credits: cost };
				const items = await buildAdvancedItems(user.id, safeArgs);
				const extraArgs = getAdvancedExtraArgs(safeArgs);
				argsForProvider = { items, ...extraArgs };
			} else {
				// Parse server_config and validate method
				if (!server.server_config || !server.server_config.methods) {
					return res.status(400).json({ error: "Server configuration is invalid" });
				}
				methodConfig = server.server_config.methods[method];
				if (!methodConfig) {
					return res.status(400).json({
						error: "Method not available",
						message: `Method "${method}" is not available on this server`,
						available_methods: Object.keys(server.server_config.methods)
					});
				}
				CREATION_CREDIT_COST = methodConfig.credits ?? 0.5;
			}

			// argsForProvider is copied into meta.args below; after hydrate / job args, meta.args is synced to argsForJob so DB matches the provider payload.
			argsForProvider = argsForProvider && typeof argsForProvider === "object" ? { ...argsForProvider } : {};

			const clipResolved = await resolveAudioProviderArgs(
				queries,
				user.id,
				argsForProvider,
				getShareBaseUrl(),
				methodConfig?.fields || null
			);
			if (!clipResolved.ok) {
				console.warn("[create] audio resolve failed", {
					method,
					audio_creation_id: argsForProvider.audio_creation_id ?? null,
					error: clipResolved.error
				});
				return res.status(clipResolved.status).json({
					error: clipResolved.error,
					message: clipResolved.error,
					code: clipResolved.code || "audio_resolve_failed"
				});
			}
			if (clipResolved.handled && clipResolved.cdnId) {
				const minted = await materializeBlueProviderAudioArgs(
					queries,
					user.id,
					clipResolved.args,
					{
						providerBase: getShareBaseUrl(),
						methodFields: methodConfig?.fields || null
					}
				);
				if (!minted.ok) {
					console.warn("[create] audio_creation_id mint failed", {
						method,
						audio_creation_id: clipResolved.args?.audio_creation_id ?? null,
						error: minted.error
					});
					return res.status(minted.status).json({
						error: minted.error,
						message: minted.error,
						code: minted.code || "audio_resolve_failed"
					});
				}
			}
			argsForProvider = clipResolved.args;
			const stillResolved = await resolveEphemeralStillProviderArgs(argsForProvider, {
				userId: user.id,
				queries
			});
			if (!stillResolved.ok) {
				return res.status(stillResolved.status || 400).json({
					error: stillResolved.error,
					message: stillResolved.error,
					code: stillResolved.code || "still_resolve_failed"
				});
			}
			if (argsForProvider.audio_creation_id != null || clipResolved.handled) {
				console.log("[create] audio resolve", {
					method,
					audio_creation_id: argsForProvider.audio_creation_id ?? null,
					audio_start_sec: argsForProvider.audio_start_sec ?? null,
					audio_duration_sec: argsForProvider.audio_duration_sec ?? null,
					handled: Boolean(clipResolved.handled),
					has_input_audio_urls: Array.isArray(argsForProvider.input_audio_urls)
						? argsForProvider.input_audio_urls.length
						: 0
				});
			}

			const voiceFileResolved = await resolveVoiceFileForProvider(
				queries,
				user.id,
				argsForProvider
			);
			if (!voiceFileResolved.ok) {
				return res.status(voiceFileResolved.status).json({
					error: voiceFileResolved.error,
					message: voiceFileResolved.error
				});
			}
			argsForProvider = voiceFileResolved.args;

			// Exact text the user entered (before $style expansion, hydrate JSON, create.html style wrapper, etc.).
			// Shown on creation detail; meta.args.prompt is the provider payload (see More Info).
			const originalPromptForMeta =
				typeof argsForProvider.prompt === "string" ? argsForProvider.prompt.trim() : "";

			// $style tokens in prompt: strip sigils and append "style:" section (all methods — not only advanced_generate).
			// When the client sends style_key (carousel or composer), resolve legacy + catalog styles — drop $ tokens.
			if (typeof argsForProvider.prompt === "string") {
				const pickerModifiers = await resolveStyleModifiersForPicker(
					queries,
					user.id,
					typeof style_key === "string" ? style_key : ""
				);
				if (pickerModifiers !== null) {
					argsForProvider.prompt = applyPickerStyleModifiersToPrompt(
						argsForProvider.prompt,
						pickerModifiers
					);
				} else {
					const expanded = await expandStyleSigilsForProvider(
						queries,
						user.id,
						argsForProvider.prompt
					);
					if (!expanded.ok) {
						return res.status(400).json({
							error: "Invalid style references",
							message: (expanded.failed_styles || [])
								.map((f) => `${f.token} (${f.reason})`)
								.join(", "),
							failed_styles: expanded.failed_styles
						});
					}
					argsForProvider.prompt = expanded.providerPrompt;
				}
			}

			// Async hint: only for methods that explicitly support async.
			// Cloud uses QStash-based polling; local mirrors the same behavior with in-process polling.
			const asyncSupportedForMethod =
				methodConfig && (methodConfig.async === true || methodConfig.async === "true");
			const asyncRequestedForMethod = Boolean(asyncSupportedForMethod);

			// Apply style transformation when style_key is provided (create.html flow). Store style in meta; user_prompt is originalPromptForMeta (captured above).
			let styleForMeta = null;
			if (style_key && typeof style_key === "string" && !isAdvancedGenerate) {
				const styleKeyTrim = style_key.trim();
				const styleInfo = getStyleInfo(styleKeyTrim);
				if (styleInfo) {
					styleForMeta = { key: styleInfo.key, label: styleInfo.label, modifiers: styleInfo.modifiers };
				} else {
					const catalogMods = await resolveStyleModifiersForPicker(
						queries,
						user.id,
						styleKeyTrim
					);
					if (catalogMods !== null) {
						styleForMeta = {
							key: styleKeyTrim,
							label: styleKeyTrim,
							modifiers: catalogMods
						};
					}
				}
			}

			// Clients may send a single `image_url` string; some providers (e.g. xai via replicate) expect `input_images` (array).
			// When the method schema declares `input_images` as image_url_array, map here so callers stay simple.
			if (!isAdvancedGenerate && methodConfig?.fields && typeof methodConfig.fields === "object") {
				const fields = methodConfig.fields;
				const wantsInputImagesArray = fields.input_images?.type === "image_url_array";
				const hasImageUrlField = Object.prototype.hasOwnProperty.call(fields, "image_url");
				const applyMap = (argsObj) => {
					if (!argsObj || typeof argsObj !== "object") return;
					const inputImagesEmpty =
						!Array.isArray(argsObj.input_images) || argsObj.input_images.length === 0;
					const imageUrlStr =
						typeof argsObj.image_url === "string" ? argsObj.image_url.trim() : "";
					if (!wantsInputImagesArray || !inputImagesEmpty || !imageUrlStr) return;
					argsObj.input_images = [imageUrlStr];
					if (!hasImageUrlField) {
						delete argsObj.image_url;
					}
				};
				applyMap(argsForProvider);
				applyMap(safeArgs);
			}

			// Provider must fetch image URLs; relative paths fail. Normalize any field of type image_url or image_url_array to absolute URL(s).
			const methodFields = methodConfig?.fields && typeof methodConfig.fields === "object" ? methodConfig.fields : {};
			const imageUrlKeys = Object.keys(methodFields).filter((k) => methodFields[k]?.type === "image_url");
			if (imageUrlKeys.length === 0 && typeof argsForProvider.image_url === "string") {
				imageUrlKeys.push("image_url");
			}
			let imageUrlArrayKeys = Object.keys(methodFields).filter((k) => methodFields[k]?.type === "image_url_array");
			if (imageUrlArrayKeys.length === 0 && Array.isArray(argsForProvider.input_images)) {
				imageUrlArrayKeys = ["input_images"];
			}
			for (const key of imageUrlKeys) {
				if (typeof argsForProvider[key] === "string") {
					const absolute = toParasceneImageUrl(argsForProvider[key]);
					if (absolute) argsForProvider[key] = absolute;
				}
			}
			for (const key of imageUrlArrayKeys) {
				if (Array.isArray(argsForProvider[key])) {
					argsForProvider[key] = argsForProvider[key].map((v) => {
						if (typeof v !== "string") return v;
						const absolute = toParasceneImageUrl(v);
						return absolute || v;
					});
				}
			}

			// Normalize and validate mutate_parent_ids (optional list of additional ancestor IDs)
			let mutateParentIds = [];
			if (Array.isArray(mutate_parent_ids)) {
				const seen = new Set();
				mutateParentIds = mutate_parent_ids
					.map((v) => Number(v))
					.filter((n) => {
						if (!Number.isFinite(n) || n <= 0) return false;
						if (seen.has(n)) return false;
						seen.add(n);
						return true;
					});
			} else if (typeof mutate_parent_ids === "string" && mutate_parent_ids.trim()) {
				try {
					const parsed = JSON.parse(mutate_parent_ids);
					if (Array.isArray(parsed)) {
						const seen = new Set();
						mutateParentIds = parsed
							.map((v) => Number(v))
							.filter((n) => {
								if (!Number.isFinite(n) || n <= 0) return false;
								if (seen.has(n)) return false;
								seen.add(n);
								return true;
							});
					}
				} catch {
					// ignore malformed mutate_parent_ids
				}
			}

			const methodFieldsForLimit =
				methodConfig?.fields && typeof methodConfig.fields === "object" ? methodConfig.fields : {};
			for (const [fieldName, fieldDef] of Object.entries(methodFieldsForLimit)) {
				const max = Number(fieldDef?.max_length);
				if (!Number.isFinite(max) || max <= 0) continue;
				const value = argsForProvider?.[fieldName];
				if (typeof value === "string" && value.length > max) {
					return res.status(400).json({
						error: "Argument too long",
						message: `${fieldName} must be at most ${max} characters.`
					});
				}
			}

			if (Number(server_id) === PARASCENE_BLUE_SERVER_ID) {
				delete argsForProvider.always_next;
				const boostRaw =
					argsForProvider.credits_boost ?? argsForProvider.max_bid;
				const named = resolveProductNamedPrice(boostRaw, CREATION_CREDIT_COST);
				delete argsForProvider.credits_boost;
				argsForProvider.max_bid = named.max_bid;
				CREATION_CREDIT_COST = named.cost;
			} else {
				delete argsForProvider.max_bid;
				delete argsForProvider.always_next;
				delete argsForProvider.credits_boost;
			}

			// Check user's credit balance
			let credits = await queries.selectUserCredits.get(user.id);

			// Initialize credits if record doesn't exist
			if (!credits) {
				await queries.insertUserCredits.run(user.id, 100, null);
				credits = await queries.selectUserCredits.get(user.id);
			}

			// Check if user has sufficient credits
			if (!credits || credits.balance < CREATION_CREDIT_COST) {
				return res.status(402).json({
					error: "Insufficient credits",
					message: `Creation requires ${CREATION_CREDIT_COST} credits. You have ${credits?.balance ?? 0} credits.`,
					required: CREATION_CREDIT_COST,
					current: credits?.balance ?? 0
				});
			}

			const started_at = nowIso();
			const placeholderFilename = `creating_${user.id}_${Date.now()}.png`;
			const meta = {
				creation_token: creation_token.trim(),
				server_id: Number(server_id),
				server_name: typeof server.name === "string" ? server.name : null,
				server_url: server.server_url,
				method,
				method_name: typeof methodConfig.name === "string" && methodConfig.name.trim()
					? methodConfig.name.trim()
					: null,
				args: argsForProvider,
				started_at,
				credit_cost: CREATION_CREDIT_COST,
				...(styleForMeta ? { style: styleForMeta } : {}),
				...(originalPromptForMeta !== "" ? { user_prompt: originalPromptForMeta } : {}),
			};
			if (
				methodConfig?.intent === "audio_generate" ||
				methodConfig?.intent === "voice_train" ||
				creationMethodIsAudio(method)
			) {
				meta.media_type = "audio";
			}

			// Mutate lineage: create/extend meta.history
			if (mutate_of_id != null && Number.isFinite(Number(mutate_of_id))) {
				const sourceId = Number(mutate_of_id);

				let source = await queries.selectCreatedImageById.get(sourceId, user.id);
				if (!source) {
					const any = await queries.selectCreatedImageByIdAnyUser?.get(sourceId);
					if (any) {
						const isPublished = any.published === 1 || any.published === true;
						const isAdmin = user.role === 'admin';
						if (isPublished || isAdmin) {
							source = any;
						}
					}
				}

				if (!source) {
					const groupIdForMutate = parsePositiveIntQuery(bodyGroupId ?? bodyGroupOf);
					if (groupIdForMutate) {
						const groupRow = await selectOwnedGroupRow(groupIdForMutate, user.id);
						if (groupRow && isGroupSourceOfSharedCreation(groupRow, sourceId)) {
							source = await queries.selectCreatedImageByIdAnyUser?.get(sourceId);
						}
					}
				}

				if (!source) {
					return res.status(404).json({ error: "Image not found" });
				}

				const sourceMeta = parseMeta(source.meta) || {};
				const lineage = buildMutateLineageMetaFields(sourceMeta, sourceId);
				if (!lineage) {
					return res.status(404).json({ error: "Image not found" });
				}
				Object.assign(meta, lineage);

				// Normalize all image_url- and image_url_array-typed fields for mutate flows.
				for (const key of imageUrlKeys) {
					if (typeof safeArgs[key] === "string") {
						const normalized = toParasceneImageUrl(safeArgs[key]);
						if (normalized) {
							safeArgs[key] = normalized;
							meta.args[key] = normalized;
						}
					}
				}
				for (const key of imageUrlArrayKeys) {
					if (Array.isArray(safeArgs[key])) {
						const normalized = safeArgs[key].map((v) => {
							if (typeof v !== "string") return v;
							const n = toParasceneImageUrl(v);
							return n || v;
						});
						safeArgs[key] = normalized;
						meta.args[key] = normalized;
					}
				}

				// Unpublished sources: provider cannot use /api/images/created/:filename (403).
				// Use share URL when the submitted input is the source image itself — not alternate inputs (e.g. generic frame captures).
				const sourcePublished = source.published === 1 || source.published === true;
				if (!sourcePublished && source.status === "completed" && source.filename) {
					try {
						const token = mintShareToken({
							version: ACTIVE_SHARE_VERSION,
							imageId: source.id,
							sharedByUserId: user.id
						});
						const shareUrl = `${providerBase}/api/share/${encodeURIComponent(ACTIVE_SHARE_VERSION)}/${encodeURIComponent(token)}/image`;
						applySourceShareUrlToMutateArgsWhenMatching({
							safeArgs,
							metaArgs: meta.args,
							shareUrl,
							imageUrlKeys,
							imageUrlArrayKeys,
							sourceFilename: source.filename,
							baseOrigin: providerBase,
						});
					} catch {
						// If mint fails, keep existing URLs; provider may 403 for unpublished
					}
				}
			}

			// Single parent from create flow (e.g. one queued image): track lineage like mutate so we don't lose the chain.
			if (
				(mutate_of_id == null || !Number.isFinite(Number(mutate_of_id))) &&
				mutateParentIds.length === 1
			) {
				const sourceId = Number(mutateParentIds[0]);
				let source = await queries.selectCreatedImageById.get(sourceId, user.id);
				if (!source) {
					const any = await queries.selectCreatedImageByIdAnyUser?.get(sourceId);
					if (any) {
						const isPublished = any.published === 1 || any.published === true;
						const isAdmin = user.role === 'admin';
						if (isPublished || isAdmin) {
							source = any;
						}
					}
				}
				if (source) {
					const sourceMeta = parseMeta(source.meta) || {};
					const lineage = buildMutateLineageMetaFields(sourceMeta, sourceId);
					if (lineage) Object.assign(meta, lineage);
					// Unpublished source: use share URL when input matches source image (not generic frame uploads).
					const sourcePublished = source.published === 1 || source.published === true;
					if (!sourcePublished && source.status === "completed" && source.filename) {
						try {
							const token = mintShareToken({
								version: ACTIVE_SHARE_VERSION,
								imageId: source.id,
								sharedByUserId: user.id
							});
							const shareUrl = `${providerBase}/api/share/${encodeURIComponent(ACTIVE_SHARE_VERSION)}/${encodeURIComponent(token)}/image`;
							applySourceShareUrlToMutateArgsWhenMatching({
								safeArgs,
								metaArgs: meta.args,
								shareUrl,
								imageUrlKeys,
								imageUrlArrayKeys,
								sourceFilename: source.filename,
								baseOrigin: providerBase,
							});
						} catch {
							// If mint fails, keep existing URLs
						}
					}
				}
			}

			// Merge any additional ancestor IDs into meta.history so lineage can reference multiple parents.
			if (mutateParentIds.length > 0) {
				const base = Array.isArray(meta.history) ? meta.history : [];
				const merged = [...base, ...mutateParentIds];
				const seenMerge = new Set();
				const mergedIds = merged
					.map((v) => Number(v))
					.filter((n) => {
						if (!Number.isFinite(n) || n <= 0) return false;
						if (seenMerge.has(n)) return false;
						seenMerge.add(n);
						return true;
					});
				if (mergedIds.length > 0) {
					meta.history = mergedIds;
				}
				// Record which IDs were direct parents in this generation (for display: + between combined parents).
				const existing = Array.isArray(meta.direct_parent_ids) ? meta.direct_parent_ids : [];
				const seen = new Set();
				meta.direct_parent_ids = [...existing, ...mutateParentIds].filter((n) => {
					const num = Number(n);
					if (!Number.isFinite(num) || num <= 0) return false;
					if (seen.has(num)) return false;
					seen.add(num);
					return true;
				});
			}

			// Replace every parascene image URL that points to an unpublished creation with a share URL
			// so the provider can fetch it (create flow with multiple images, or any URL not covered by single-parent blocks above).
			async function replaceUnpublishedUrlWithShareUrl(url) {
				const image = await resolveCreatedImageRowForProviderImageUrl({
					queries,
					url,
					baseOrigin: providerBase,
				});
				if (!image) {
					return toParasceneImageUrl(url) || url;
				}
				const isPublished = image.published === 1 || image.published === true;
				if ((image.status || "") !== "completed") {
					return toParasceneImageUrl(url) || url;
				}
				const isOwner = image.user_id === user.id;
				const isAdmin = user.role === "admin";
				if (!isPublished && !isOwner && !isAdmin) {
					return toParasceneImageUrl(url) || url;
				}
				// Use share URL so provider can fetch without auth (published and unpublished).
				const shareUrl = shareUrlForImage(image.id, user.id);
				return shareUrl || toParasceneImageUrl(url) || url;
			}
			for (const key of imageUrlKeys) {
				if (typeof safeArgs[key] === "string") {
					safeArgs[key] = await replaceUnpublishedUrlWithShareUrl(safeArgs[key]);
					meta.args[key] = safeArgs[key];
				}
			}
			for (const key of imageUrlArrayKeys) {
				if (Array.isArray(safeArgs[key])) {
					const arr = await Promise.all(
						safeArgs[key].map((v) => (typeof v === "string" ? replaceUnpublishedUrlWithShareUrl(v) : Promise.resolve(v)))
					);
					safeArgs[key] = arr;
					meta.args[key] = arr;
				}
			}

			// Unpublished videos: provider cannot GET /api/videos/created/… (403).
			// Same share-token rewrite as images — /api/share/…/video needs no session.
			let videoUrlKeys = Object.keys(methodFields).filter((k) => methodFields[k]?.type === "video_url");
			let videoUrlArrayKeys = Object.keys(methodFields).filter((k) => methodFields[k]?.type === "video_url_array");
			if (videoUrlArrayKeys.length === 0 && Array.isArray(safeArgs.input_video_urls)) {
				videoUrlArrayKeys = ["input_video_urls"];
			}
			if (videoUrlKeys.length === 0 && typeof safeArgs.input_video_url === "string") {
				videoUrlKeys.push("input_video_url");
			}
			async function replaceUnpublishedVideoUrlWithShareUrl(url) {
				const creationId = creationIdFromParasceneVideoUrl(url, providerBase);
				if (!creationId || !queries.selectCreatedImageByIdAnyUser?.get) {
					return url;
				}
				const image = await queries.selectCreatedImageByIdAnyUser.get(creationId);
				if (!image) return url;
				const isPublished = image.published === 1 || image.published === true;
				if ((image.status || "") !== "completed") {
					return url;
				}
				const isOwner = image.user_id === user.id;
				const isAdmin = user.role === "admin";
				if (!isPublished && !isOwner && !isAdmin) return url;
				return shareUrlForVideo(image.id, user.id) || url;
			}
			for (const key of videoUrlKeys) {
				if (typeof safeArgs[key] === "string") {
					safeArgs[key] = await replaceUnpublishedVideoUrlWithShareUrl(safeArgs[key]);
					meta.args[key] = safeArgs[key];
				}
			}
			for (const key of videoUrlArrayKeys) {
				if (Array.isArray(safeArgs[key])) {
					const arr = await Promise.all(
						safeArgs[key].map((v) =>
							typeof v === "string" ? replaceUnpublishedVideoUrlWithShareUrl(v) : Promise.resolve(v)
						)
					);
					safeArgs[key] = arr;
					meta.args[key] = arr;
				}
			}

			const normalizeUsername = (input) => {
				const raw = typeof input === "string" ? input.trim() : "";
				if (!raw) return null;
				const normalized = raw.toLowerCase();
				if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) return null;
				return normalized;
			};

			const extractMentions = (text) => {
				const out = [];
				const seen = new Set();
				const re = /@([a-zA-Z0-9_]+)/g;
				let match;
				while ((match = re.exec(text || "")) !== null) {
					const token = match[1] || "";
					const originalMention = `@${token}`;
					const normalized = normalizeUsername(token);
					const key = normalized ? `@${normalized}` : originalMention;
					if (seen.has(key)) continue;
					seen.add(key);
					out.push({ originalMention, normalized });
				}
				return out;
			};

			const hydrateMentionsToCast = async (promptText) => {
				const cast = {};
				const failed_mentions = [];
				const promptStr = typeof promptText === "string" ? promptText : "";
				const mentions = extractMentions(promptStr);
				if (mentions.length === 0) return { cast, failed_mentions, mentions };

				for (const m of mentions) {
					if (!m.normalized) {
						failed_mentions.push({ mention: m.originalMention, reason: "invalid_username" });
						continue;
					}
					const resolved = await resolveCastTextForMentionTag(user.id, m.normalized);
					if (!resolved.ok) {
						failed_mentions.push({ mention: `@${m.normalized}`, reason: resolved.reason });
						continue;
					}
					cast[`@${m.normalized}`] = resolved.text;
				}

				return { cast, failed_mentions, mentions };
			};

			// Retry in place: reuse the same creation row instead of inserting a new one
			if (retry_of_id != null && Number.isFinite(Number(retry_of_id))) {
				const existingId = Number(retry_of_id);
				const image = await queries.selectCreatedImageById.get(existingId, user.id);
				if (!image) {
					return res.status(404).json({ error: "Image not found" });
				}
				const status = image.status || "completed";
				if (status === "completed") {
					return res.status(400).json({
						error: "Cannot retry",
						message: "Only failed or timed-out creations can be retried"
					});
				}
				if (isCreationGpuInFlight(status) && !isCreationFinishTimedOut(status, parseMeta(image.meta) || {})) {
					return res.status(400).json({
						error: "Cannot retry",
						message: "Creation is still in progress"
					});
				}
				const existingMeta = parseMeta(image.meta) || {};
				// Preserve existing history on retries (including mutated creations).
				if (Array.isArray(existingMeta.history)) {
					meta.history = existingMeta.history;
				}

				let argsForJob = meta.args;
				if (hydrateMentions === true) {
					const promptText = typeof meta.args?.prompt === "string" ? meta.args.prompt : "";
					const { cast, failed_mentions } = await hydrateMentionsToCast(promptText);
					if (failed_mentions.length > 0) {
						const failedAt = nowIso();
						const nextMeta = {
							...meta,
							failed_at: failedAt,
							error_code: "hydrate_mentions_failed",
							error: "Unable to hydrate one or more @mentions (users or personas).",
							failed_mentions,
							hydrate_mentions: true
						};
						await queries.updateCreatedImageJobFailed.run(existingId, user.id, { meta: nextMeta });
						const updatedCredits = await queries.selectUserCredits.get(user.id);
						return res.json({
							id: existingId,
							status: "failed",
							created_at: started_at,
							meta: nextMeta,
							credits_remaining: updatedCredits?.balance ?? credits?.balance ?? 0
						});
					}
					if (Object.keys(cast).length > 0) {
						argsForJob = { ...meta.args, prompt: JSON.stringify({ cast, prompt: promptText }, null, 2) };
					}
				}
				meta.args = argsForJob;

				// Refund previous attempt if it was never refunded (so we don't double-charge)
				if (existingMeta.credits_refunded !== true && Number(existingMeta.credit_cost) > 0) {
					await queries.updateUserCreditsBalance.run(user.id, Number(existingMeta.credit_cost));
				}
				await queries.updateUserCreditsBalance.run(user.id, -CREATION_CREDIT_COST);
				await queries.resetCreatedImageForRetry.run(existingId, user.id, {
					meta,
					filename: placeholderFilename
				});
				await scheduleCreationJob({
					payload: {
						created_image_id: existingId,
						user_id: user.id,
						server_id: Number(server_id),
						method,
						args: argsForJob,
						credit_cost: CREATION_CREDIT_COST,
						async: asyncRequestedForMethod,
					},
					runCreationJob: ({ payload }) => runCreationJob({ queries, storage, payload }),
				});
				const updatedCredits = await queries.selectUserCredits.get(user.id);
				return res.json({
					id: existingId,
					status: "creating",
					created_at: started_at,
					meta,
					credits_remaining: updatedCredits?.balance ?? 0
				});
			}

			// New creation: insert a durable row BEFORE provider call
			let argsForJob = meta.args;
			if (hydrateMentions === true) {
				const promptText = typeof meta.args?.prompt === "string" ? meta.args.prompt : "";
				const { cast, failed_mentions } = await hydrateMentionsToCast(promptText);
				if (failed_mentions.length > 0) {
					const failedAt = nowIso();
					const failedFilename = `failed_hydrate_${user.id}_${Date.now()}.png`;
					const nextMeta = {
						...meta,
						failed_at: failedAt,
						error_code: "hydrate_mentions_failed",
						error: "Unable to hydrate one or more @mentions (users or personas).",
						failed_mentions,
						hydrate_mentions: true
					};
					const result = await queries.insertCreatedImage.run(
						user.id,
						failedFilename,
						"", // file_path placeholder (schema requires non-null)
						1024,
						1024,
						null,
						"failed",
						nextMeta
					);
					const updatedCredits = await queries.selectUserCredits.get(user.id);
					return res.json({
						id: result.insertId,
						status: "failed",
						created_at: started_at,
						meta: nextMeta,
						credits_remaining: updatedCredits?.balance ?? credits?.balance ?? 0
					});
				}
				if (Object.keys(cast).length > 0) {
					argsForJob = { ...meta.args, prompt: JSON.stringify({ cast, prompt: promptText }, null, 2) };
				}
			}
			meta.args = argsForJob;

			await queries.updateUserCreditsBalance.run(user.id, -CREATION_CREDIT_COST);
   chargedAmount = CREATION_CREDIT_COST;

			const result = await queries.insertCreatedImage.run(
				user.id,
				placeholderFilename,
				"", // file_path placeholder (schema requires non-null)
				1024,
				1024,
				null,
				"creating",
				meta
			);

			const createdImageId = result.insertId;
   admittedCreationId = createdImageId;

			if (v2GroupId) {
				const appended = await appendCreationToOwnedGroupV2(queries, {
					groupId: v2GroupId,
					userId: user.id,
					createdRow: {
						id: createdImageId,
						title: null,
						filename: placeholderFilename,
						file_path: "",
						status: "creating",
						width: 1024,
						height: 1024,
						color: null,
						meta,
					},
					mediaType: typeof meta?.media_type === "string" ? meta.media_type : "image",
				});
				if (!appended.ok) {
const error = new Error(appended.error || 'Failed to add creation to group');
     error.status = 400;
     throw error;
				}
			}

			await scheduleCreationJob({
				payload: {
					created_image_id: createdImageId,
					user_id: user.id,
					server_id: Number(server_id),
					method,
					args: argsForJob,
					credit_cost: CREATION_CREDIT_COST,
					async: asyncRequestedForMethod,
				},
				runCreationJob: ({ payload }) => runCreationJob({ queries, storage, payload }),
			});

   jobScheduled = true;
			const updatedCredits = await queries.selectUserCredits.get(user.id);

			return res.json({
				id: createdImageId,
				status: "creating",
				created_at: started_at,
				meta,
				credits_remaining: updatedCredits?.balance ?? 0
			});
		} catch (error) {
   if (chargedAmount > 0 && !jobScheduled) {
    try {
     let failedMeta;
     if (admittedCreationId) {
      const row = await queries.selectCreatedImageById.get(admittedCreationId, user.id);
      failedMeta = { ...parseMeta(row?.meta), error: error.message, credit_cost: chargedAmount, credits_refunded: false };
      await queries.updateCreatedImageJobFailed.run(admittedCreationId, user.id, { meta: failedMeta });
     }
     await queries.updateUserCreditsBalance.run(user.id, chargedAmount);
     if (admittedCreationId) await queries.updateCreatedImageJobFailed.run(admittedCreationId, user.id, { meta: { ...failedMeta, credits_refunded: true } });
    } catch (refundError) { console.error('[create] admission refund failed', { userId: user.id, creationId: admittedCreationId, error: refundError.message }); }
   }
			// console.error("Error initiating image creation:", error);
			return res.status([400, 402, 503].includes(error.status) ? error.status : 500).json({ error: error.status === 402 ? "Insufficient credits" : "Failed to initiate image creation", message: error.message });
		}
	}));
router.post("/api/create/worker", asyncRoute(async (req, res) => {
		// Disable caching for this endpoint - QStash webhooks should never be cached
		res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
		res.setHeader("Pragma", "no-cache");
		res.setHeader("Expires", "0");

		const logCreation = (...args) => {
			console.log("[Creation]", ...args);
		};
		const logCreationError = (...args) => {
			console.error("[Creation]", ...args);
		};

		try {
			logCreation("Worker endpoint called", {
				has_body: !!req.body,
				created_image_id: req.body?.created_image_id,
				user_id: req.body?.user_id,
				path: req.path,
				originalUrl: req.originalUrl,
				method: req.method
			});

			if (!process.env.UPSTASH_QSTASH_TOKEN) {
				logCreationError("QStash not configured");
				return res.status(503).json({ error: "QStash not configured" });
			}

			logCreation("Verifying QStash signature");
			const isValid = await verifyQStashRequest(req);
			if (!isValid) {
				logCreationError("Invalid QStash signature");
				return res.status(401).json({ error: "Invalid QStash signature" });
			}

			const jobType = req.body?.job_type;
			if (jobType === "landscape") {
				logCreation("QStash signature verified, running landscape job");
				await runLandscapeJob({ queries, storage, payload: req.body });
				logCreation("Landscape job completed successfully");
			} else if (jobType === "audio_cover" || jobType === "audio_cover_poll") {
				logCreation("QStash signature verified, running audio cover job");
				await runAudioCoverJob({ queries, storage, payload: req.body });
				logCreation("Audio cover job completed successfully");
			} else if (jobType === "poll_provider") {
				logCreation("QStash signature verified, running provider poll job");
				await runProviderPollJob({ queries, storage, payload: req.body });
				logCreation("Provider poll job completed successfully");
			} else {
				logCreation("QStash signature verified, running job");
				await runCreationJob({ queries, storage, payload: req.body });
				logCreation("Worker job completed successfully");
			}
			return res.json({ ok: true });
		} catch (error) {
			logCreationError("Worker failed with error:", {
				error: error.message,
				stack: error.stack,
				name: error.name
			});
			console.error("Error running create worker:", error);
			return res.status(500).json({ ok: false, error: "Worker failed" });
		}
	}));
router.get("/api/create/images", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const pageLimit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
			const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
			const challengeOnly =
				req.query.challenge_only === "1" || req.query.challenge_only === "true";

			const enableNsfw = Boolean(user.meta && user.meta.enableNsfw === true);
			const images = await queries.selectCreatedImagesForUser.all(user.id, {
				limit: pageLimit,
				offset,
				viewerEnableNsfw: enableNsfw,
				challengeOnly
			});

			const imagesWithUrls = [];
			for (const img of Array.isArray(images) ? images : []) {
				const status = img.status || "completed";
				if (isCreationGpuInFlight(status) || status === "failed") {
					void healProviderPollOnRead({
						queries,
						storage,
						image: img,
						userId: user.id,
					}).catch(() => {});
				}
				let meta = parseMeta(img.meta);
				if (isGroupV2Meta(meta)) {
					meta = await fillThinGroupV2ItemViews(queries, user.id, meta);
				}
				const mediaFields =
					status === "completed"
						? mapCreatedImageRowMediaFields({ ...img, meta }, { storage, includeMeta: false })
						: {
							url: null,
							thumbnail_url: null,
							fit_thumbnail_url: null,
							video_url: null,
							audio_url: null,
							media_type: typeof meta?.media_type === "string" ? meta.media_type : "image"
						};

				imagesWithUrls.push({
					id: img.id,
					filename: img.filename,
					file_path: typeof img.file_path === "string" ? img.file_path : null,
					url: mediaFields.url,
					thumbnail_url: mediaFields.thumbnail_url,
					fit_thumbnail_url: mediaFields.fit_thumbnail_url ?? null,
					width: img.width,
					height: img.height,
					color: img.color,
					status,
					created_at: img.created_at,
					published: img.published === 1 || img.published === true,
					published_at: img.published_at || null,
					title: img.title || null,
					description: img.description || null,
					meta,
					nsfw: !!meta?.nsfw,
					is_moderated_error: isModeratedError(status, meta),
					media_type: mediaFields.media_type,
					video_url: mediaFields.video_url,
					audio_url: mediaFields.audio_url
				});
			}

			const rawGroup = wantsRawGroupV2(req);
			const visible = imagesWithUrls.filter((img) => {
				if (!enableNsfw && img.nsfw) return false;
				if (!rawGroup && isHiddenInGroupMeta(img.meta)) return false;
				return true;
			}).map((img) => applyCostumeToCreationPayload(img, { raw: rawGroup }));
			const has_more = images.length === pageLimit;
			const filtered = visible;

			// Stamp organizer media refs (hero/results/theme-vote) so library trophies match detail.
			try {
				const sbHeal = getSupabaseServiceClient();
				if (sbHeal) {
					await healChallengeOrganizerRefsForCreationList({
						queries,
						sb: sbHeal,
						images: filtered
					});
				}
			} catch {
				// ignore heal failures
			}

			// Flag challenge entries whose challenge has ended so the grid can drop the "pending" blur.
			try {
				const endedMap = await computeChallengeEndedByImageId({
					sb: getSupabaseServiceClient(),
					images: filtered
				});
				if (endedMap.size > 0) {
					for (const item of filtered) {
						if (endedMap.has(item.id)) item.challenge_ended = endedMap.get(item.id);
					}
				}
			} catch {
				// On failure, leave challenge_ended unset (cards stay blurred — safe default).
			}

			return res.json({ images: filtered, has_more });
		} catch (error) {
			// console.error("Error fetching images:", error);
			return res.status(500).json({ error: "Failed to fetch images" });
		}
	}));
router.get("/api/create/images/:id/mutate-source", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const groupId = parsePositiveIntQuery(req.params.id);
			const sourceId = parsePositiveIntQuery(req.query?.source_id);
			if (!groupId || !sourceId) {
				return res.status(400).json({ error: "group id and source_id are required" });
			}

			const groupRow = await selectOwnedGroupRow(groupId, user.id);
			if (!groupRow) {
				return res.status(404).json({ error: "Image not found" });
			}

			const payload = await buildGroupMutateSourcePayload({
				groupRow,
				sourceId,
				viewerUser: user
			});
			if (!payload) {
				return res.status(404).json({ error: "Image not found" });
			}
			if (payload.error === "not_ready") {
				return res.status(409).json({ error: "Source is not ready to mutate" });
			}

			return res.json(payload);
		} catch {
			return res.status(500).json({ error: "Failed to fetch mutate source" });
		}
	}));
router.get("/api/create/import-suno/preview", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const url = typeof req.query?.url === "string" ? req.query.url.trim() : "";
		if (!url) {
			return res.status(400).json({ error: "Missing url" });
		}

		try {
			const result = await previewSunoImport({ userId: user.id, url });
			return res.json(result);
		} catch (err) {
			const status = Number(err?.status) || 500;
			const message =
				typeof err?.message === "string" && err.message.trim()
					? err.message.trim()
					: "Failed to preview song";
			if (status >= 500) {
				console.error("[create] import-suno preview failed:", err?.message || err);
			}
			return res.status(status).json({ error: message });
		}
	}));
router.post("/api/create/import-suno", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
		if (!url) {
			return res.status(400).json({ error: "Missing url" });
		}

		try {
			const creationToken =
				typeof req.body?.creation_token === "string" ? req.body.creation_token.trim() : "";
			const result = await importSunoCreation({
				userId: user.id,
				url,
				...(creationToken ? { creationToken } : {}),
				queries,
				storage,
			});
			return res.status(201).json(result);
		} catch (err) {
			const status = Number(err?.status) || 500;
			const message =
				typeof err?.message === "string" && err.message.trim()
					? err.message.trim()
					: "Failed to import song";
			if (status >= 500) {
				console.error("[create] import-suno failed:", err?.message || err);
			}
			return res.status(status).json({ error: message });
		}
	}));
router.get("/api/create/import-youtube/preview", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const url = typeof req.query?.url === "string" ? req.query.url.trim() : "";
		if (!url) {
			return res.status(400).json({ error: "Missing url" });
		}

		try {
			const result = await previewYoutubeImport({ userId: user.id, url });
			return res.json(result);
		} catch (err) {
			const status = Number(err?.status) || 500;
			const message =
				typeof err?.message === "string" && err.message.trim()
					? err.message.trim()
					: "Failed to preview video";
			if (status >= 500) {
				console.error("[create] import-youtube preview failed:", err?.message || err);
			}
			return res.status(status).json({ error: message });
		}
	}));
router.post("/api/create/import-youtube", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
		if (!url) {
			return res.status(400).json({ error: "Missing url" });
		}

		try {
			const creationToken =
				typeof req.body?.creation_token === "string" ? req.body.creation_token.trim() : "";
			const result = await importYoutubeCreation({
				userId: user.id,
				url,
				...(creationToken ? { creationToken } : {}),
				queries,
				storage,
			});
			return res.status(201).json(result);
		} catch (err) {
			const status = Number(err?.status) || 500;
			const message =
				typeof err?.message === "string" && err.message.trim()
					? err.message.trim()
					: "Failed to import video";
			if (status >= 500) {
				console.error("[create] import-youtube failed:", err?.message || err);
			}
			return res.status(status).json({ error: message });
		}
	}));
router.post("/api/create/ephemeral-still/start", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const result = await startEphemeralStill({
				userId: user.id,
				filename: req.body?.filename,
				contentType: req.body?.content_type,
				queries
			});
			return res.json(result);
		} catch (err) {
			const status = Number(err?.status) || 500;
			const message =
				typeof err?.message === "string" && err.message.trim()
					? err.message.trim()
					: "Failed to start still upload";
			if (status >= 500) {
				console.error("[create] ephemeral-still start failed:", err?.message || err);
			}
			return res.status(status).json({ error: message });
		}
	}));
router.post("/api/create/ephemeral-still/finalize", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const result = await finalizeEphemeralStill({
				userId: user.id,
				ticket: req.body?.ticket,
				queries
			});
			return res.status(201).json(result);
		} catch (err) {
			const status = Number(err?.status) || 500;
			const message =
				typeof err?.message === "string" && err.message.trim()
					? err.message.trim()
					: "Failed to store still";
			if (status >= 500) {
				console.error("[create] ephemeral-still finalize failed:", err?.message || err);
			}
			return res.status(status).json({ error: message });
		}
	}));
router.get("/api/create/ephemeral-still/:token", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const link = await mintEphemeralStillFetch({
				userId: user.id,
				token: req.params.token,
				queries
			});
			res.set("Cache-Control", "private, no-store");
			const wantJson =
				req.query?.format === "json" ||
				String(req.headers.accept || "").toLowerCase().includes("application/json");
			if (wantJson) {
				return res.json({ url: link.url, expires_at: link.expires_at || null });
			}
			return res.redirect(302, link.url);
		} catch (err) {
			const status = Number(err?.status) || 500;
			const message =
				typeof err?.message === "string" && err.message.trim()
					? err.message.trim()
					: "Failed to load still";
			if (status >= 500) {
				console.error("[create] ephemeral-still redirect failed:", err?.message || err);
			}
			return res.status(status).json({ error: message });
		}
	}));
router.post("/api/create/import-audio/start", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const result = await startAudioFileImport({
				userId: user.id,
				filename: req.body?.filename,
				contentType: req.body?.content_type,
				queries
			});
			return res.json(result);
		} catch (err) {
			const status = Number(err?.status) || 500;
			const message =
				typeof err?.message === "string" && err.message.trim()
					? err.message.trim()
					: "Failed to start audio import";
			if (status >= 500) {
				console.error("[create] import-audio start failed:", err?.message || err);
			}
			return res.status(status).json({ error: message });
		}
	}));
router.post("/api/create/import-audio/finalize", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const creationToken =
				typeof req.body?.creation_token === "string" ? req.body.creation_token.trim() : "";
			const result = await finalizeAudioFileImport({
				userId: user.id,
				ticket: req.body?.ticket,
				title: req.body?.title,
				durationSec: req.body?.duration_sec,
				...(creationToken ? { creationToken } : {}),
				queries,
				storage
			});
			return res.status(201).json(result);
		} catch (err) {
			const status = Number(err?.status) || 500;
			const message =
				typeof err?.message === "string" && err.message.trim()
					? err.message.trim()
					: "Failed to import audio";
			if (status >= 500) {
				console.error("[create] import-audio finalize failed:", err?.message || err);
			}
			return res.status(status).json({ error: message });
		}
	}));
router.put("/api/create/images/:id", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		const id = Number(req.params.id);
		if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid creation ID" });
		try {
			let image = await queries.selectCreatedImageById.get(id, user.id);
			const isAdmin = user.role === "admin";
			if (!image && isAdmin) image = await queries.selectCreatedImageByIdAnyUser?.get(id);
			if (!image) {
				const existing = await queries.selectCreatedImageByIdAnyUser?.get(id);
				if (!existing) return res.status(404).json({ error: "Image not found" });
				return res.status(403).json({ error: "Forbidden: You can only edit your own creations" });
			}
			const title = typeof req.body?.title === "string"
				? (req.body.title.trim() || null)
				: (typeof image.title === "string" && image.title.trim() ? image.title.trim() : null);
			const description = typeof req.body?.description === "string"
				? (req.body.description.trim() || null)
				: (typeof image.description === "string" && image.description.trim() ? image.description.trim() : null);
			const updateResult = await queries.updateCreatedImage.run(id, user.id, title, description, isAdmin);
			if (!updateResult?.changes) return res.status(500).json({ error: "Failed to update image" });
			const nextMeta = { ...(parseMeta(image.meta) || {}) };
			let metaDirty = false;
			if (typeof req.body?.nsfw === "boolean") {
				nextMeta.nsfw = req.body.nsfw;
				metaDirty = true;
			}
			if (typeof req.body?.doom_scroll_full_height === "boolean") {
				nextMeta.doom_scroll_full_height = req.body.doom_scroll_full_height;
				metaDirty = true;
			}
			const importProvider = typeof nextMeta.import?.provider === "string"
				? nextMeta.import.provider.trim().toLowerCase()
				: "";
			if (importProvider === "youtube") {
				try {
					const refreshed = await refreshYoutubeImportCover({
						imageId: id,
						userId: image.user_id,
						meta: nextMeta,
						color: image.color,
						queries,
						storage,
					});
					if (refreshed) metaDirty = false;
				} catch {
					// Title and description still save when the cover refresh fails.
				}
			}
			if (metaDirty) await queries.updateCreatedImageMeta.run(id, image.user_id, nextMeta);
			const feedItem = await queries.selectFeedItemByCreatedImageId?.get(id);
			if (feedItem) {
				await queries.updateFeedItem?.run(id, title || "Untitled", description || "");
				await bumpFeedVersionCounter(queries);
				void invalidateFeedBetaCatalogSnapshot().catch(() => {});
			}
			const updated = image.user_id === user.id
				? await queries.selectCreatedImageById.get(id, user.id)
				: await queries.selectCreatedImageByIdAnyUser?.get(id);
			const updatedMeta = parseMeta(updated?.meta) || nextMeta;
			return res.json({
				id: updated?.id ?? id,
				title: updated?.title ?? title,
				description: updated?.description ?? description,
				meta: updatedMeta,
				nsfw: updatedMeta.nsfw === true,
			});
		} catch (err) {
			console.error("[PUT /api/create/images/:id]", err);
			return res.status(500).json({ error: "Failed to update image" });
		}
	}));
router.post("/api/create/images/:id/publish", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		const id = Number(req.params.id);
		if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid creation ID" });
		try {
			let image = await queries.selectCreatedImageById.get(id, user.id);
			const isAdmin = user.role === "admin";
			if (!image && isAdmin) image = await queries.selectCreatedImageByIdAnyUser?.get(id);
			if (!image) return res.status(404).json({ error: "Image not found" });
			if (image.status !== "completed") return res.status(400).json({ error: "Only completed creations can be published" });
			if (image.unavailable_at) return res.status(400).json({ error: "Unavailable creations cannot be published" });
			if (image.published === true || image.published === 1) return res.status(400).json({ error: "Image is already published" });
			const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
			const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
			const publishResult = await queries.publishCreatedImage.run(id, user.id, title || null, description || null, isAdmin);
			if (!publishResult.changes) return res.status(404).json({ error: "Image not found" });
			const meta = parseMeta(image.meta);
			if (typeof req.body?.nsfw === "boolean" || typeof req.body?.doom_scroll_full_height === "boolean") {
				const nextMeta = { ...meta };
				if (typeof req.body.nsfw === "boolean") nextMeta.nsfw = req.body.nsfw;
				if (typeof req.body.doom_scroll_full_height === "boolean") nextMeta.doom_scroll_full_height = req.body.doom_scroll_full_height;
				await queries.updateCreatedImageMeta.run(id, image.user_id, nextMeta);
			}
			const existingFeedItem = await queries.selectFeedItemByCreatedImageId?.get(id);
			let author = user.email || "User";
			if (image.user_id && Number(image.user_id) !== Number(user.id)) {
				try {
					const creator = await queries.selectUserById.get(image.user_id);
					if (creator?.email) author = creator.email;
				} catch { /* Keep the authenticated user's email as a fallback. */ }
			}
			if (existingFeedItem) {
				await queries.updateFeedItem?.run(id, title || "Untitled", description);
			} else {
				await queries.insertFeedItem.run(title || "Untitled", description, author, null, id);
			}
			await bumpFeedVersionCounter(queries);
			void invalidateFeedBetaCatalogSnapshot().catch(() => {});
			return res.json({ success: true, id, published: true });
		} catch (err) {
			console.error("[POST /api/create/images/:id/publish]", err);
			return res.status(Number(err?.status) || 500).json({ error: err?.message || "Failed to publish creation" });
		}
	}));
router.post("/api/create/images/:id/unpublish", asyncRoute(async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;
		const id = Number(req.params.id);
		if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid creation ID" });
		try {
			let image = await queries.selectCreatedImageById.get(id, user.id);
			const isAdmin = user.role === "admin";
			if (!image && isAdmin) image = await queries.selectCreatedImageByIdAnyUser?.get(id);
			if (!image) return res.status(404).json({ error: "Image not found" });
			if (image.published !== true && image.published !== 1) return res.status(400).json({ error: "Image is not published" });
			const result = await queries.unpublishCreatedImage.run(id, user.id, isAdmin);
			if (!result.changes) return res.status(404).json({ error: "Image not found" });
			await queries.deleteFeedItemByCreatedImageId?.run(id);
			await queries.deleteAllLikesForCreatedImage?.run(id);
			await queries.deleteAllCommentsForCreatedImage?.run(id);
			await bumpFeedVersionCounter(queries);
			void invalidateFeedBetaCatalogSnapshot().catch(() => {});
			return res.json({ success: true, id, published: false });
		} catch (err) {
			console.error("[POST /api/create/images/:id/unpublish]", err);
			return res.status(Number(err?.status) || 500).json({ error: err?.message || "Failed to unpublish creation" });
		}
	}));
registerCreationLibraryRoutes({ router, requireUser, queries, storage });
return router;
}
