import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Busboy from "busboy";
import sharp from "sharp";
import {
	appendCreationIdToMediaUrl,
	appendShareAccessToMediaUrl,
	getThumbnailUrl,
	isCreatedMediaThumbnailRequest,
	isCreatedMediaFitThumbnailRequest,
	getBaseAppUrl,
	getShareBaseUrl
} from "./utils/url.js";
import {
	aspectRatioForGroupFirstSource,
	shouldGenerateFitThumbnail,
	withGroupAspectRatioFromFirst,
} from "./utils/fitThumbnail.js";
import { buildProviderHeaders } from "./utils/providerAuth.js";
import {
	runCreationJob,
	runProviderPollJob,
	PROVIDER_TIMEOUT_MS,
	fetchImageBufferFromUrl,
	createPlaceholderImageBuffer,
} from "./utils/creationJob.js";
import { runLandscapeJob } from "./utils/landscapeJob.js";
import { scheduleCreationJob, scheduleLandscapeJob } from "./utils/scheduleCreationJob.js";
import { scheduleEmbeddingJob } from "./utils/embeddingJob.js";
import { deleteCreationEmbedding } from "./utils/embeddings.js";
import { buildClipOwnersMeta, resolveAudioClipProviderArgs, resolveClipIdFromOutputMeta } from "./utils/audioClips.js";
import { getSupabaseServiceClient } from "./utils/supabaseService.js";
import { verifyQStashRequest } from "./utils/qstashVerification.js";
import {
	resolveCreatedImageRowForCreatedMediaPath,
	resolveCreatedImageStorageFilename,
} from "./utils/resolveCreatedImageStorageFilename.js";
import { invalidateFeedBetaCatalogSnapshot } from "./feedBeta/catalogSnapshot.js";
import { mapCreatedImageRowMediaFields } from "./utils/resolveCreationDisplayMedia.js";
import {
	canSetVideoPosterFromFirstFrame,
	getLandscapeOutpaintEligibility,
	parseAspectRatioString,
} from "../public/shared/aspectRatio.js";
import { normalizeEditedUploadBuffer } from "./utils/editedImageUpload.js";
import { ACTIVE_SHARE_VERSION, mintShareToken, verifyShareToken } from "./utils/shareLink.js";
import { getStyleInfo } from "./utils/createStyles.js";
import {
	applyPickerStyleModifiersToPrompt,
	expandStyleSigilsForProvider,
	extractStyleSigilTokens,
	resolveStyleModifiersForPicker,
	stripStyleSigilsFromPrompt
} from "./utils/styleSigils.js";
import { applyVynlyShareWatermark } from "./utils/vynlyShareWatermark.js";
import { creationRowIsVideo } from "./utils/vynlyShareFromCreation.js";
import { sendBufferWithRangeSupport } from "./utils/sendBufferWithRangeSupport.js";
import { broadcastRoomDirty, broadcastUserInboxDirty } from "./utils/realtimeBroadcast.js";
import { insertNotificationsForChatMentions } from "./utils/chatMentionNotifications.js";
import { notifyCreationMentionsOnPublish } from "./utils/activityNotifications.js";
import {
	canViewUnpublishedCreationViaChallengeMessage,
	canViewUnpublishedCreationViaChallengeHero,
	fetchChatChannelThreadRow,
	findChallengesChannelThreadId,
	validateChallengeSubmission,
	summarizeChallengeSubmissionPhases,
	computeChallengeEndedByImageId
} from "./utils/challengeSubmitShared.js";
import { resolveCreationImageForExport } from "./utils/resolveCreationImageForExport.js";
import { applySourceShareUrlToMutateArgsWhenMatching } from "./utils/mutateLineageImageUrl.js";
import { buildMutateLineageMetaFields } from "./utils/mutateLineageMeta.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isPng(buffer) {
	return (
		buffer &&
		Buffer.isBuffer(buffer) &&
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	);
}

async function ensurePngBuffer(buffer) {
	if (isPng(buffer)) return buffer;
	return await sharp(buffer, { failOn: "none" }).png().toBuffer();
}

function buildGenericUrl(key) {
	const segments = String(key || "")
		.split("/")
		.filter(Boolean)
		.map((seg) => encodeURIComponent(seg));
	return `/api/images/generic/${segments.join("/")}`;
}

function normalizeShareAudioContentType(raw) {
	const ct = String(raw || "").toLowerCase().trim();
	if (!ct) return "audio/webm";
	if (ct.startsWith("audio/webm")) return "audio/webm";
	if (ct.startsWith("audio/ogg")) return "audio/ogg";
	if (ct.startsWith("audio/mp4") || ct.includes("m4a")) return "audio/mp4";
	if (ct.startsWith("audio/")) return ct.split(";")[0].trim();
	return "audio/webm";
}

function shareAudioExtFromContentType(contentType) {
	const ct = normalizeShareAudioContentType(contentType);
	if (ct === "audio/ogg") return "ogg";
	if (ct === "audio/mp4") return "m4a";
	return "webm";
}

async function ensureAudioClipLibraryRowFromShareAudio({
	queries,
	storageKey,
	mimeType,
	byteSize,
	extractorUserId,
	sourceCreation,
	durationSec = null,
}) {
	const insertFn = queries.insertAudioClip?.run;
	const getByKey = queries.selectAudioClipByStorageKey?.get;
	if (typeof insertFn !== "function" || typeof getByKey !== "function") return null;
	const key = typeof storageKey === "string" ? storageKey.trim() : "";
	if (!key) return null;
	const existing = await getByKey(key);
	if (existing) return existing;
	const creatorId = Number(extractorUserId);
	if (!Number.isFinite(creatorId) || creatorId <= 0) return null;
	const videoOwnerId = Number(sourceCreation?.user_id);
	const meta = buildClipOwnersMeta({
		creatorUserId: creatorId,
		sourceUserId: Number.isFinite(videoOwnerId) && videoOwnerId > 0 ? videoOwnerId : null,
	});
	const titleBase =
		typeof sourceCreation?.title === "string" && sourceCreation.title.trim()
			? sourceCreation.title.trim()
			: `Creation #${sourceCreation?.id ?? ""}`;
	const durationNum = durationSec != null ? Number(durationSec) : null;
	const duration_sec =
		Number.isFinite(durationNum) && durationNum > 0 ? durationNum : null;
	try {
		return await insertFn({
			title: titleBase,
			description: null,
			storage_key: key,
			content_type: mimeType || "audio/webm",
			byte_size: Number(byteSize) > 0 ? Number(byteSize) : 0,
			duration_sec,
			source_type: "video_extract",
			source_created_image_id: sourceCreation?.id ?? null,
			meta,
		});
	} catch (err) {
		const msg = String(err?.message || "");
		if (err?.code === "23505" || msg.includes("duplicate key") || msg.includes("UNIQUE constraint")) {
			return getByKey(key);
		}
		console.error("[share-audio audio-clip dual-write]", err);
		return null;
	}
}

/** Matches Supabase `prsn_misc` bucket file size limit for share-audio uploads. */
const SHARE_AUDIO_MAX_BYTES = 20 * 1024 * 1024;

function guessImageContentType(filename) {
	const f = String(filename || "").toLowerCase();
	if (f.endsWith(".webp")) return "image/webp";
	if (f.endsWith(".jpg") || f.endsWith(".jpeg")) return "image/jpeg";
	if (f.endsWith(".gif")) return "image/gif";
	return "image/png";
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

export default function createCreateRoutes({ queries, storage }) {
	const router = express.Router();
	// Legacy local files under db/data/images/created (optional fallback)
	const imagesDir = path.join(__dirname, "..", "db", "data", "images", "created");
	router.use("/images/created", express.static(imagesDir));

	// GET /api/images/created/* - Serve image through backend
	// This route handles images from Supabase Storage and provides authorization.
	// Supports nested paths like "landscape/USERID_IMAGEID_timestamp_random.png".
	router.get("/api/images/created/*", async (req, res) => {
		const filename = req.params[0] || "";
		const variant = req.query?.variant;

		try {
			const image = await resolveCreatedImageRowForCreatedMediaPath({
				queries,
				filename,
				query: req.query,
			});

			if (!image) {
				return res.status(404).json({ error: "Image not found" });
			}

			if (image.unavailable_at != null && String(image.unavailable_at) !== "") {
				return res.status(404).json({ error: "Image not found" });
			}

			// Thumbnails are public: low-res, unguessable filenames, used in <img>/poster everywhere.
			// Fit thumbs are public the same way (native-aspect alt; missing → 404 for client fallback).
			// Full-size (no variant) stays behind owner/published/delegation checks below.
			const wantsThumbnail = isCreatedMediaThumbnailRequest(variant);
			const wantsFit = isCreatedMediaFitThumbnailRequest(variant);

			if (!wantsThumbnail && !wantsFit) {
			// Check access: user owns the image OR image is published OR user is admin OR lineage delegation
			const userId = req.auth?.userId;
			const isOwner = viewerOwnsCreationRow(image, userId);
			const isPublished = isCreationPublished(image);

			// Get user to check admin role
			let isAdmin = false;
			let viewerRole = "";
			if (userId && !isOwner && !isPublished) {
				try {
					const user = await queries.selectUserById.get(userId);
					isAdmin = user?.role === "admin";
					viewerRole = user?.role || "";
				} catch {
					// ignore errors checking user
				}
			}

			let lineageOk = false;
			const lineageRaw = req.query?.lineage_of;
			const lineageParentId = typeof lineageRaw === "string" ? parseInt(lineageRaw, 10) : Number(lineageRaw);
			if (!isOwner && !isPublished && !isAdmin && userId && Number.isFinite(lineageParentId) && lineageParentId > 0) {
				try {
					const u = await queries.selectUserById.get(userId);
					viewerRole = u?.role || viewerRole;
					lineageOk = await canViewUnpublishedCreationViaLineageDelegation({
						ancestorRow: image,
						lineageParentId,
						viewerUserId: userId,
						viewerRole: u?.role || ""
					});
				} catch {
					lineageOk = false;
				}
			}
			let creationDelegationOk = false;
			if (!isOwner && !isPublished && !isAdmin) {
				try {
					if (userId && !viewerRole) {
						const u = await queries.selectUserById.get(userId);
						viewerRole = u?.role || "";
					}
					creationDelegationOk = await tryCreationDelegationForMediaRequest(req, {
						ancestorRow: image,
						userId,
						viewerRole
					});
				} catch {
					creationDelegationOk = false;
				}
			}

			let challengeMessageOk = false;
			const challengeMsgRawImg = req.query?.challenge_message_id ?? req.query?.challenge_msg;
			const challengeMidImg =
				typeof challengeMsgRawImg === "string" ? parseInt(challengeMsgRawImg, 10) : Number(challengeMsgRawImg);
			if (!isOwner && !isPublished && !isAdmin && userId && Number.isFinite(challengeMidImg) && challengeMidImg > 0) {
				const sbCh = getSupabaseServiceClient();
				if (sbCh) {
					try {
						challengeMessageOk = await canViewUnpublishedCreationViaChallengeMessage(sbCh, {
							ancestorRow: image,
							challengeMessageId: challengeMidImg,
							viewerUserId: userId
						});
					} catch {
						challengeMessageOk = false;
					}
				}
			}

			let challengeHeroOk = false;
			const challengeIdRawImg = req.query?.challenge_id;
			const challengeIdImg =
				typeof challengeIdRawImg === "string" ? challengeIdRawImg.trim() : String(challengeIdRawImg || "").trim();
			if (!isOwner && !isPublished && !isAdmin && userId) {
				const sbHero = getSupabaseServiceClient();
				if (sbHero) {
					try {
						challengeHeroOk = await canViewUnpublishedCreationViaChallengeHero(sbHero, {
							ancestorRow: image,
							challengeId: challengeIdImg || undefined,
							viewerUserId: userId
						});
					} catch {
						challengeHeroOk = false;
					}
				}
			}

			let shareDelegationOk = false;
			const shareVersionRaw = req.query?.share_version;
			const shareTokenRaw = req.query?.share_token;
			const shareVersion =
				typeof shareVersionRaw === "string" ? shareVersionRaw.trim() : String(shareVersionRaw || "").trim();
			const shareToken =
				typeof shareTokenRaw === "string" ? shareTokenRaw.trim() : String(shareTokenRaw || "").trim();
			if (!isOwner && !isPublished && !isAdmin && shareVersion && shareToken) {
				try {
					shareDelegationOk = await canViewViaShareTokenDelegation({
						ancestorRow: image,
						shareVersion,
						shareToken,
						queries
					});
				} catch {
					shareDelegationOk = false;
				}
			}

			if (
				!isOwner &&
				!isPublished &&
				!isAdmin &&
				!lineageOk &&
				!creationDelegationOk &&
				!challengeMessageOk &&
				!challengeHeroOk &&
				!shareDelegationOk
			) {
				return res.status(403).json({ error: "Access denied" });
			}
			}

			// Serve current storage key when the URL path is a stale filename (e.g. after video poster update).
			const storageFilename =
				filename.startsWith("landscape/")
					? filename
					: (resolveCreatedImageStorageFilename(image) || filename);
			const imageBuffer = await storage.getImageBuffer(storageFilename, { variant });
			if (wantsFit) {
				res.setHeader(
					"Content-Type",
					isPng(imageBuffer) ? "image/png" : "image/jpeg"
				);
				res.setHeader("Cache-Control", "public, max-age=3600");
				const body = isPng(imageBuffer)
					? await ensurePngBuffer(imageBuffer)
					: imageBuffer;
				return res.send(body);
			}
			const png = await ensurePngBuffer(imageBuffer);

			// Set appropriate content type
			res.setHeader('Content-Type', 'image/png');
			res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
			res.send(png);
		} catch (error) {
			// console.error("Error serving image:", error);
			if (error.message && error.message.includes("not found")) {
				return res.status(404).json({ error: "Image not found" });
			}
			return res.status(500).json({ error: "Failed to serve image" });
		}
	});

	// GET /api/videos/created/* - Serve videos through backend with same auth rules as images.
	router.get("/api/videos/created/*", async (req, res) => {
		const filename = req.params[0] || "";

		try {
			if (!filename || typeof storage.getVideoBuffer !== "function") {
				return res.status(404).json({ error: "Video not found" });
			}

			let image = null;

			// Video files are stored under "video/{userId}_{imageId}_{timestamp}_{random}.ext"
			// Derive imageId from the filename and look up the original creation.
			if (filename.startsWith("video/")) {
				const afterPrefix = filename.slice("video/".length);
				const baseName = afterPrefix.split("/").pop() || "";
				const withoutExt = baseName.replace(/\.[^.]+$/, "");
				const parts = withoutExt.split("_");
				const imageId = Number(parts[1]); // video/{userId}_{imageId}_{timestamp}_{random}.ext

				if (!Number.isFinite(imageId) || imageId <= 0) {
					return res.status(404).json({ error: "Video not found" });
				}

				image = await queries.selectCreatedImageByIdAnyUser?.get(imageId);
			}

			if (!image) {
				return res.status(404).json({ error: "Video not found" });
			}

			const userId = req.auth?.userId;
			const isOwner = viewerOwnsCreationRow(image, userId);
			const isPublished = isCreationPublished(image);

			let isAdmin = false;
			let viewerRoleVideo = "";
			if (userId && !isOwner && !isPublished) {
				try {
					const user = await queries.selectUserById.get(userId);
					isAdmin = user?.role === "admin";
					viewerRoleVideo = user?.role || "";
				} catch {
					// ignore errors checking user
				}
			}

			let lineageOkVideo = false;
			const lineageRawV = req.query?.lineage_of;
			const lineageParentIdV = typeof lineageRawV === "string" ? parseInt(lineageRawV, 10) : Number(lineageRawV);
			if (!isOwner && !isPublished && !isAdmin && userId && Number.isFinite(lineageParentIdV) && lineageParentIdV > 0) {
				try {
					if (!viewerRoleVideo) {
						const u = await queries.selectUserById.get(userId);
						viewerRoleVideo = u?.role || "";
					}
					lineageOkVideo = await canViewUnpublishedCreationViaLineageDelegation({
						ancestorRow: image,
						lineageParentId: lineageParentIdV,
						viewerUserId: userId,
						viewerRole: viewerRoleVideo
					});
				} catch {
					lineageOkVideo = false;
				}
			}
			let creationDelegationOkVideo = false;
			if (!isOwner && !isPublished && !isAdmin) {
				try {
					if (!viewerRoleVideo) {
						const u = await queries.selectUserById.get(userId);
						viewerRoleVideo = u?.role || "";
					}
					creationDelegationOkVideo = await tryCreationDelegationForMediaRequest(req, {
						ancestorRow: image,
						userId,
						viewerRole: viewerRoleVideo
					});
				} catch {
					creationDelegationOkVideo = false;
				}
			}

			let challengeMessageOkVideo = false;
			const challengeMsgRawVid = req.query?.challenge_message_id ?? req.query?.challenge_msg;
			const challengeMidVid =
				typeof challengeMsgRawVid === "string" ? parseInt(challengeMsgRawVid, 10) : Number(challengeMsgRawVid);
			if (!isOwner && !isPublished && !isAdmin && userId && Number.isFinite(challengeMidVid) && challengeMidVid > 0) {
				const sbVid = getSupabaseServiceClient();
				if (sbVid) {
					try {
						challengeMessageOkVideo = await canViewUnpublishedCreationViaChallengeMessage(sbVid, {
							ancestorRow: image,
							challengeMessageId: challengeMidVid,
							viewerUserId: userId
						});
					} catch {
						challengeMessageOkVideo = false;
					}
				}
			}

			let challengeHeroOkVideo = false;
			const challengeIdRawVid = req.query?.challenge_id;
			const challengeIdVid =
				typeof challengeIdRawVid === "string" ? challengeIdRawVid.trim() : String(challengeIdRawVid || "").trim();
			if (!isOwner && !isPublished && !isAdmin && userId) {
				const sbHeroVid = getSupabaseServiceClient();
				if (sbHeroVid) {
					try {
						challengeHeroOkVideo = await canViewUnpublishedCreationViaChallengeHero(sbHeroVid, {
							ancestorRow: image,
							challengeId: challengeIdVid || undefined,
							viewerUserId: userId
						});
					} catch {
						challengeHeroOkVideo = false;
					}
				}
			}

			let shareDelegationOkVideo = false;
			const shareVersionRawV = req.query?.share_version;
			const shareTokenRawV = req.query?.share_token;
			const shareVersionV =
				typeof shareVersionRawV === "string" ? shareVersionRawV.trim() : String(shareVersionRawV || "").trim();
			const shareTokenV =
				typeof shareTokenRawV === "string" ? shareTokenRawV.trim() : String(shareTokenRawV || "").trim();
			if (!isOwner && !isPublished && !isAdmin && shareVersionV && shareTokenV) {
				try {
					shareDelegationOkVideo = await canViewViaShareTokenDelegation({
						ancestorRow: image,
						shareVersion: shareVersionV,
						shareToken: shareTokenV,
						queries
					});
				} catch {
					shareDelegationOkVideo = false;
				}
			}

			if (
				!isOwner &&
				!isPublished &&
				!isAdmin &&
				!lineageOkVideo &&
				!creationDelegationOkVideo &&
				!challengeMessageOkVideo &&
				!challengeHeroOkVideo &&
				!shareDelegationOkVideo
			) {
				return res.status(403).json({ error: "Access denied" });
			}

			const meta = parseMeta(image.meta);
			const videoMeta = meta && typeof meta === "object" ? meta.video : null;
			let contentType = "video/mp4";
			if (videoMeta && typeof videoMeta.content_type === "string" && videoMeta.content_type) {
				contentType = videoMeta.content_type;
			}

			const videoBuffer = await storage.getVideoBuffer(filename);
			return sendBufferWithRangeSupport(res, videoBuffer, {
				contentType,
				cacheControl: "public, max-age=3600",
				rangeHeader: typeof req.headers.range === "string" ? req.headers.range : "",
			});
		} catch (error) {
			if (error.message && error.message.includes("not found")) {
				return res.status(404).json({ error: "Video not found" });
			}
			return res.status(500).json({ error: "Failed to serve video" });
		}
	});

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

	const MAX_CHALLENGE_CHAT_BODY_CHARS = 4000;

	async function appendChallengeSubmitEligibility(req, user, image, meta, response) {
		const status = response.status || "completed";
		const pub = response.published === true || response.published === 1;
		const group = meta?.group?.kind === "group_creations";

		if (Number(user.id) !== Number(image.user_id)) {
			return;
		}
		if (status !== "completed") {
			response.challenge_submit = { eligible: false, reason: "not_completed" };
			return;
		}
		if (pub) {
			response.challenge_submit = { eligible: false, reason: "published" };
			return;
		}
		if (group) {
			response.challenge_submit = { eligible: false, reason: "group" };
			return;
		}

		const raw = req.query?.challenge_submit_thread;
		let threadId = NaN;
		if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
			threadId = typeof raw === "string" ? Number(raw.trim()) : Number(raw);
		}

		const sb = getSupabaseServiceClient();
		if ((!Number.isFinite(threadId) || threadId <= 0) && sb) {
			try {
				const canonical = await findChallengesChannelThreadId(sb);
				if (canonical != null) threadId = canonical;
			} catch {
				// ignore; threadId stays invalid
			}
		}

		if (!Number.isFinite(threadId) || threadId <= 0) {
			return;
		}

		if (!sb) {
			response.challenge_submit = { eligible: false, reason: "service_unavailable" };
			return;
		}

		const v = await validateChallengeSubmission({
			sb,
			userId: user.id,
			ownerUserId: image.user_id,
			creationId: Number(image.id),
			meta,
			threadId,
			note: ""
		});
		if (!v.ok) {
			response.challenge_submit = {
				eligible: false,
				reason: "blocked",
				message: v.message
			};
			return;
		}
		const cfg = v.cfg && typeof v.cfg === "object" ? v.cfg : {};
		const rawTitle = typeof cfg.title === "string" ? cfg.title.trim() : "";
		const cidStr = String(v.challengeId || "").trim();
		const challengeTitle =
			rawTitle || (cidStr ? `Challenge: ${cidStr}` : "Challenge");
		let challengeDetails = "";
		if (cfg.details != null) {
			challengeDetails =
				typeof cfg.details === "string"
					? cfg.details.trim()
					: String(cfg.details).trim();
		}
		response.challenge_submit = {
			eligible: true,
			reason: null,
			thread_id: threadId,
			challenge: {
				challenge_id: cidStr,
				title: challengeTitle,
				details: challengeDetails
			}
		};
	}

	async function bumpFeedVersionCounter() {
		if (!queries.selectPolicyByKey?.get || !queries.upsertPolicyKey?.run) return;
		const key = "version_feed";
		const description = "Global feed cache version. Increment when published feed content changes.";
		try {
			const row = await queries.selectPolicyByKey.get(key);
			const current = Number.parseInt(String(row?.value ?? "0"), 10);
			const next = Number.isFinite(current) && current >= 0 ? current + 1 : 1;
			await queries.upsertPolicyKey.run(key, String(next), description);
		} catch (err) {
			console.warn("[create] Failed to bump feed version:", err?.message || err);
		}
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

	/** Character text for cast hydration: Prompt Library personas store it in injection_text (and sometimes meta). */
	function characterFromPersonaRow(row) {
		if (!row) return "";
		const pMeta = parseMeta(row.meta) || {};
		const fromInj = typeof row.injection_text === "string" ? row.injection_text.trim() : "";
		const fromMeta =
			typeof pMeta.character_description === "string" ? pMeta.character_description.trim() : "";
		return fromInj || fromMeta;
	}

	/**
	 * Resolve @handle to character description for image cast (user profile or Prompt Library persona).
	 * Personas use the same visibility rules as the library / suggest autocomplete.
	 */
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

	/** Ids listed on a creation as lineage inputs (history chain, mutate parent, multi-parent). */
	function collectLineageAncestorIdsFromParentMeta(parentMeta) {
		const m = parentMeta && typeof parentMeta === "object" ? parentMeta : {};
		const s = new Set();
		const add = (v) => {
			const n = Number(v);
			if (Number.isFinite(n) && n > 0) s.add(n);
		};
		if (Array.isArray(m.history)) {
			for (const v of m.history) add(v);
		}
		if (m.mutate_of_id != null) add(m.mutate_of_id);
		if (Array.isArray(m.direct_parent_ids)) {
			for (const v of m.direct_parent_ids) add(v);
		}
		return s;
	}

	async function buildLineageDescendantsForParent(parentId, user) {
		const parentRow = await queries.selectCreatedImageByIdAnyUser?.get(parentId);
		const viewerId = Number(user.id);
		const isAdmin = user.role === "admin";
		const parentOwnerId = parentRow ? Number(parentRow.user_id) : NaN;

		function canViewUnpublishedChild(childRow) {
			if (childRow.published === true || childRow.published === 1) return true;
			if (isAdmin) return true;
			const childOwnerId = Number(childRow.user_id);
			if (Number.isFinite(childOwnerId) && childOwnerId === viewerId) return true;
			if (Number.isFinite(parentOwnerId) && parentOwnerId === viewerId) return true;
			return false;
		}

		function mapLineageChildRow(row, { unpublished = false } = {}) {
			const status = row.status || "completed";
			const url =
				status === "completed"
					? (row.file_path || storage.getImageUrl(row.filename))
					: null;
			const rowMeta = parseMeta(row.meta);
			const mediaType = typeof rowMeta?.media_type === "string" ? rowMeta.media_type : "image";
			const videoMeta = rowMeta && typeof rowMeta === "object" ? rowMeta.video : null;
			const videoUrl =
				videoMeta && typeof videoMeta.file_path === "string" && videoMeta.file_path
					? videoMeta.file_path
					: null;
			return {
				id: row.id,
				title: row.title ?? null,
				created_at: row.created_at,
				url: url || null,
				thumbnail_url: url ? getThumbnailUrl(url) : null,
				nsfw: !!(row.nsfw),
				media_type: mediaType,
				video_url: videoUrl,
				...(unpublished ? { unpublished: true } : {}),
			};
		}

		const childRows = await queries.selectCreatedImageChildrenByParentId?.all(parentId) ?? [];
		const direct = childRows
			.filter((row) => canViewUnpublishedChild(row))
			.map((row) => mapLineageChildRow(row, {
				unpublished: !(row.published === true || row.published === 1),
			}));

		const descendantRows = await queries.selectCreatedImagePublishedDescendantsByAncestorId?.all(parentId) ?? [];
		const directIds = new Set(direct.map((row) => Number(row.id)));
		const indirect = descendantRows
			.filter((row) => !directIds.has(Number(row.id)))
			.map((row) => mapLineageChildRow(row));

		return [...direct, ...indirect].sort((a, b) => {
			const ta = Date.parse(a.created_at || "") || 0;
			const tb = Date.parse(b.created_at || "") || 0;
			return ta - tb || Number(a.id) - Number(b.id);
		});
	}

	/**
	 * Unpublished ancestor is readable when a viewable parent lists it in lineage meta.
	 * Parent must be published (or viewer owns parent, or admin).
	 * Cross-user unpublished inputs are allowed only when the parent is published (or viewer is admin),
	 * so an unpublished draft cannot be used to load another user's private creations by id stuffing.
	 */
	async function canViewUnpublishedCreationViaLineageDelegation({ ancestorRow, lineageParentId, viewerUserId, viewerRole }) {
		const parentId = Number(lineageParentId);
		if (!Number.isFinite(parentId) || parentId <= 0) return false;
		if (parentId === Number(ancestorRow.id)) return false;
		const parentRow = await queries.selectCreatedImageByIdAnyUser?.get(parentId);
		if (!parentRow) return false;
		if (parentRow.unavailable_at != null && String(parentRow.unavailable_at) !== "") return false;
		const parentMeta = parseMeta(parentRow.meta);
		const allowed = collectLineageAncestorIdsFromParentMeta(parentMeta);
		if (!allowed.has(Number(ancestorRow.id))) return false;

		const parentPublished = parentRow.published === 1 || parentRow.published === true;
		const viewerOwnsParent = viewerUserId != null && Number(parentRow.user_id) === Number(viewerUserId);
		const isAdmin = viewerRole === "admin";
		if (!parentPublished && !viewerOwnsParent && !isAdmin) return false;

		const crossUser = Number(parentRow.user_id) !== Number(ancestorRow.user_id);
		if (crossUser && !parentPublished && viewerRole !== "admin") return false;
		return true;
	}

	/**
	 * Unpublished source image is readable when a viewable delegated creation references it.
	 * Delegated creation can be itself, lineage ancestor, or grouped source.
	 */
	async function canViewUnpublishedCreationViaCreationDelegation({ ancestorRow, creationId, viewerUserId, viewerRole }) {
		const delegatedId = Number(creationId);
		if (!Number.isFinite(delegatedId) || delegatedId <= 0) return false;
		const delegatedRow = await queries.selectCreatedImageByIdAnyUser?.get(delegatedId);
		if (!delegatedRow) return false;
		if (delegatedRow.unavailable_at != null && String(delegatedRow.unavailable_at) !== "") return false;
		const delegatedMeta = parseMeta(delegatedRow.meta);
		const referencedIds = collectLineageAncestorIdsFromParentMeta(delegatedMeta);
		referencedIds.add(Number(delegatedRow.id));
		const groupPayload = delegatedMeta?.group && typeof delegatedMeta.group === "object" ? delegatedMeta.group : null;
		if (groupPayload?.kind === "group_creations") {
			const rawIds = Array.isArray(groupPayload.source_creation_ids) ? groupPayload.source_creation_ids : [];
			for (const id of rawIds) {
				const n = Number(id);
				if (Number.isFinite(n) && n > 0) referencedIds.add(n);
			}
			const sourceCreations = Array.isArray(groupPayload.source_creations) ? groupPayload.source_creations : [];
			for (const source of sourceCreations) {
				const n = Number(source?.id);
				if (Number.isFinite(n) && n > 0) referencedIds.add(n);
			}
			const coverSourceId = Number(groupPayload.cover_source_id);
			if (Number.isFinite(coverSourceId) && coverSourceId > 0) referencedIds.add(coverSourceId);
		}
		if (!referencedIds.has(Number(ancestorRow.id))) return false;

		const delegatedPublished = delegatedRow.published === 1 || delegatedRow.published === true;
		const viewerOwnsDelegated = viewerUserId != null && Number(delegatedRow.user_id) === Number(viewerUserId);
		const isAdmin = viewerRole === "admin";
		return !!(delegatedPublished || viewerOwnsDelegated || isAdmin);
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

	/** Mutate-from-group: resolve pixels + metadata from group row + embedded source snapshot (not archived source GET). */
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

	function isCreationPublished(row) {
		return row?.published === 1 || row?.published === true;
	}

	/** Query param first, then Referer /creations/:id when different (wrong source id baked into group URLs). */
	function collectDelegatedCreationIdCandidatesFromMediaRequest(req) {
		const out = [];
		const seen = new Set();
		const add = (raw) => {
			const id = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
			if (!Number.isFinite(id) || id <= 0 || seen.has(id)) return;
			seen.add(id);
			out.push(id);
		};
		const delegatedRaw = req.query?.creation_id ?? req.query?.group_id ?? req.query?.group_of;
		add(delegatedRaw);
		const ref = String(req.get("referer") || "");
		const m = ref.match(/\/creations\/(\d+)/);
		if (m) add(m[1]);
		return out;
	}

	async function tryCreationDelegationForMediaRequest(req, { ancestorRow, userId, viewerRole }) {
		const candidates = collectDelegatedCreationIdCandidatesFromMediaRequest(req);
		for (const creationId of candidates) {
			const ok = await canViewUnpublishedCreationViaCreationDelegation({
				ancestorRow,
				creationId,
				viewerUserId: userId ?? null,
				viewerRole
			});
			if (ok) return true;
		}
		return false;
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

	async function canViewUnavailableImageViaGroupParent({ imageRow, groupParentId, viewerUserId }) {
		if (!imageRow) return false;
		const gid = parsePositiveIntQuery(groupParentId);
		if (!gid) return false;
		const groupRow = await selectOwnedGroupRow(gid, viewerUserId);
		if (!groupRow) return false;
		return isGroupSourceOfSharedCreation(groupRow, imageRow.id);
	}

	async function canViewViaShareTokenDelegation({ ancestorRow, shareVersion, shareToken, queries }) {
		const verified = verifyShareToken({ version: shareVersion, token: shareToken });
		if (!verified.ok) return false;
		const sharedRow = await queries.selectCreatedImageByIdAnyUser?.get(verified.imageId);
		if (!sharedRow) return false;
		if (sharedRow.unavailable_at != null && String(sharedRow.unavailable_at) !== "") return false;
		const status = sharedRow.status || "completed";
		if (status !== "completed") return false;
		const sharedId = Number(sharedRow.id);
		const ancestorId = Number(ancestorRow.id);
		if (sharedId === ancestorId) return true;
		return isGroupSourceOfSharedCreation(sharedRow, ancestorId);
	}

	function rewriteGroupMetaForShareAccess(meta, shareAccess, groupCreationId) {
		if (!shareAccess || !meta || typeof meta !== "object") return meta;
		const groupPayload = meta.group && typeof meta.group === "object" ? meta.group : null;
		if (groupPayload?.kind !== "group_creations") return meta;
		const sourcesRaw = Array.isArray(groupPayload.source_creations) ? groupPayload.source_creations : [];
		const nextSources = sourcesRaw.map((source) => {
			if (!source || typeof source !== "object") return source;
			let filePath = typeof source.file_path === "string" ? source.file_path.trim() : "";
			if (!filePath) return source;
			filePath = appendCreationIdToMediaUrl(filePath, groupCreationId);
			filePath = appendShareAccessToMediaUrl(filePath, shareAccess);
			return { ...source, file_path: filePath };
		});
		return {
			...meta,
			group: {
				...groupPayload,
				source_creations: nextSources
			}
		};
	}

	/** Append lineage_of so /api/images/created and /api/videos/created accept delegated reads. */
	function appendLineageOfToMediaUrl(url, lineageParentId) {
		if (!url || !lineageParentId) return url;
		const s = String(url);
		if (!s.includes("/api/images/created/") && !s.includes("/api/videos/created/")) return url;
		try {
			const parsed = new URL(url, "http://localhost");
			parsed.searchParams.set("lineage_of", String(lineageParentId));
			return `${parsed.pathname}${parsed.search}${parsed.hash}`;
		} catch {
			const sep = s.includes("?") ? "&" : "?";
			return `${s}${sep}lineage_of=${encodeURIComponent(String(lineageParentId))}`;
		}
	}

	/** Append challenge_message_id for delegated reads of unpublished challenge entries. */
	function appendChallengeMessageIdToMediaUrl(url, challengeMessageId) {
		if (!url || !challengeMessageId) return url;
		const s = String(url);
		if (!s.includes("/api/images/created/") && !s.includes("/api/videos/created/")) return url;
		try {
			const parsed = new URL(url, "http://localhost");
			parsed.searchParams.set("challenge_message_id", String(challengeMessageId));
			return `${parsed.pathname}${parsed.search}${parsed.hash}`;
		} catch {
			const sep = s.includes("?") ? "&" : "?";
			return `${s}${sep}challenge_message_id=${encodeURIComponent(String(challengeMessageId))}`;
		}
	}

	/** Append challenge_id for delegated reads of unpublished challenge hero images. */
	function appendChallengeIdToMediaUrl(url, challengeId) {
		if (!url || !challengeId) return url;
		const s = String(url);
		if (!s.includes("/api/images/created/") && !s.includes("/api/videos/created/")) return url;
		try {
			const parsed = new URL(url, "http://localhost");
			parsed.searchParams.set("challenge_id", String(challengeId));
			return `${parsed.pathname}${parsed.search}${parsed.hash}`;
		} catch {
			const sep = s.includes("?") ? "&" : "?";
			return `${s}${sep}challenge_id=${encodeURIComponent(String(challengeId))}`;
		}
	}

	/** Only true when the provider/error message text explicitly indicates moderation. */
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

	function parsePartyPushedPayload(raw) {
		if (!Array.isArray(raw)) return null;
		const out = [];
		const seen = new Set();
		for (const entry of raw) {
			const creationId = Number(entry?.creation_id ?? entry?.creationId);
			if (!Number.isFinite(creationId) || creationId <= 0 || seen.has(creationId)) continue;
			seen.add(creationId);
			const pushedAt =
				typeof entry?.pushed_at === "string" && entry.pushed_at.trim()
					? entry.pushed_at.trim()
					: nowIso();
			const normalized = { creation_id: creationId, pushed_at: pushedAt };
			const mediaItemId =
				typeof entry?.google_photos_media_item_id === "string"
					? entry.google_photos_media_item_id.trim()
					: "";
			const albumId =
				typeof entry?.google_photos_album_id === "string" ? entry.google_photos_album_id.trim() : "";
			if (mediaItemId) normalized.google_photos_media_item_id = mediaItemId;
			if (albumId) normalized.google_photos_album_id = albumId;
			out.push(normalized);
		}
		return out;
	}

	function getGroupSourceCreationIds(meta) {
		const groupPayload = meta?.group && typeof meta.group === "object" ? meta.group : null;
		const rawIds = Array.isArray(groupPayload?.source_creation_ids) ? groupPayload.source_creation_ids : [];
		return new Set(
			rawIds
				.map((id) => Number(id))
				.filter((id) => Number.isFinite(id) && id > 0)
		);
	}

	function collectPartyGroupDeletionIds(meta, groupId) {
		const ids = new Set();
		const gid = Number(groupId);
		if (Number.isFinite(gid) && gid > 0) ids.add(gid);
		for (const id of getGroupSourceCreationIds(meta)) ids.add(id);
		const party = meta?.party && typeof meta.party === "object" ? meta.party : {};
		for (const entry of [
			...(Array.isArray(party.queue) ? party.queue : []),
			...(Array.isArray(party.pushed) ? party.pushed : [])
		]) {
			const cid = Number(entry?.creation_id ?? entry?.creationId);
			if (Number.isFinite(cid) && cid > 0) ids.add(cid);
		}
		return [...ids];
	}

	async function deleteOwnedCreationForParty(user, creationId, queries) {
		const id = Number(creationId);
		if (!Number.isFinite(id) || id <= 0) return { ok: true, skipped: true };
		const image = await queries.selectCreatedImageById.get(id, user.id);
		if (!image) return { ok: true, skipped: true };
		const meta = parseMeta(image.meta);
		const status = image.status || "completed";
		if (status === "creating") {
			const timeoutAt = meta?.timeout_at ? new Date(meta.timeout_at).getTime() : NaN;
			if (!Number.isFinite(timeoutAt) || Date.now() <= timeoutAt) {
				return { ok: false, error: "Cannot delete while a photo is still processing" };
			}
		}
		const markResult = await queries.markCreatedImageUnavailable?.run(id, user.id);
		if (!markResult || markResult.changes === 0) {
			return { ok: false, error: "Failed to delete a party photo" };
		}
		if (queries.deleteFeedItemByCreatedImageId?.run) {
			await queries.deleteFeedItemByCreatedImageId.run(id);
		}
		return { ok: true, deleted: id };
	}

	function filterPartyPushedToGroupSources(meta, pushedEntries) {
		const sourceIds = getGroupSourceCreationIds(meta);
		if (!sourceIds.size) return pushedEntries;
		return pushedEntries.filter((entry) => sourceIds.has(Number(entry.creation_id)));
	}

	const PARTY_QUEUE_STATUSES = new Set(["processing", "ready", "failed"]);

	function parsePartyQueuePayload(raw) {
		if (!Array.isArray(raw)) return null;
		const out = [];
		const seen = new Set();
		for (const entry of raw) {
			const creationId = Number(entry?.creation_id ?? entry?.creationId);
			if (!Number.isFinite(creationId) || creationId <= 0 || seen.has(creationId)) continue;
			const status = String(entry?.status || "").toLowerCase();
			if (!PARTY_QUEUE_STATUSES.has(status)) continue;
			seen.add(creationId);
			const updatedAt =
				typeof entry?.updated_at === "string" && entry.updated_at.trim()
					? entry.updated_at.trim()
					: nowIso();
			const item = { creation_id: creationId, status, updated_at: updatedAt };
			if (status === "failed" && typeof entry?.error === "string" && entry.error.trim()) {
				item.error = entry.error.trim().slice(0, 280);
			}
			out.push(item);
		}
		return out;
	}

	function filterPartyQueueToGroupSources(meta, queueEntries, pushedEntries = []) {
		const sourceIds = getGroupSourceCreationIds(meta);
		const pushedIds = new Set(
			(Array.isArray(pushedEntries) ? pushedEntries : [])
				.map((entry) => Number(entry?.creation_id))
				.filter((id) => Number.isFinite(id) && id > 0)
		);
		return queueEntries.filter((entry) => {
			const id = Number(entry.creation_id);
			if (pushedIds.has(id)) return false;
			if (!sourceIds.size) return true;
			return sourceIds.has(id);
		});
	}

	function removeCreationFromPartyGroupMeta(meta, creationId) {
		const id = Number(creationId);
		if (!Number.isFinite(id) || id <= 0) return null;
		const baseMeta = meta && typeof meta === "object" ? { ...meta } : {};
		const partyRaw = baseMeta.party && typeof baseMeta.party === "object" ? baseMeta.party : {};
		const existingQueue = Array.isArray(partyRaw.queue) ? partyRaw.queue : [];
		const existingPushed = Array.isArray(partyRaw.pushed) ? partyRaw.pushed : [];
		const nextQueue = existingQueue.filter((entry) => Number(entry?.creation_id) !== id);
		const nextPushed = existingPushed.filter((entry) => Number(entry?.creation_id) !== id);

		const groupPayload =
			baseMeta.group && typeof baseMeta.group === "object" ? { ...baseMeta.group } : null;
		let removedFromGroup = false;
		if (groupPayload?.kind === "group_creations") {
			const sourceCreationsRaw = Array.isArray(groupPayload.source_creations)
				? groupPayload.source_creations
				: [];
			const sourceCreations = sourceCreationsRaw.filter((item) => item && typeof item === "object");
			const remaining = sourceCreations
				.filter((item) => Number(item.id) !== id)
				.map((item, index) => ({ ...item, order: index }));
			removedFromGroup = remaining.length !== sourceCreations.length;
			const coverSourceId = Number(groupPayload.cover_source_id);
			const nextCoverId =
				coverSourceId === id ? Number(remaining[0]?.id) || 0 : coverSourceId > 0 ? coverSourceId : Number(remaining[0]?.id) || 0;
			baseMeta.group = {
				...groupPayload,
				updated_at: nowIso(),
				cover_source_id: nextCoverId,
				source_creation_ids: remaining
					.map((item) => Number(item.id))
					.filter((n, idx, arr) => Number.isFinite(n) && n > 0 && arr.indexOf(n) === idx),
				source_creations: remaining
			};
		}

		baseMeta.party = {
			...partyRaw,
			queue: nextQueue,
			pushed: nextPushed
		};
		return { meta: baseMeta, removedFromGroup };
	}

	// Provider must fetch image URLs; use share subdomain (sh.parascene.com) so unauthenticated provider requests are allowed.
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

	/** Build share-page image URL (no auth) for provider. Returns null if mint fails. */
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

	// Data Builder option keys (boolean flags). Other keys (e.g. prompt) are passed through to the provider.
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

	/** Build creation_meta subset for provider: inputs, how the image was created, and lineage (args, method_name, server_name, history, mutate_of_id). */
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

	// Build balanced items array (up to 100) from boolean Data Builder options. Used by query and create.
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

	// POST /api/create/preview - Return the exact payload that would be sent to the provider (no provider call, no charge)
	router.post("/api/create/preview", async (req, res) => {
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
			const clipResolved = await resolveAudioClipProviderArgs(
				queries,
				user.id,
				extraArgs,
				getShareBaseUrl()
			);
			if (!clipResolved.ok) {
				return res.status(clipResolved.status).json({ error: clipResolved.error });
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
	});

	// POST /api/create/query - Query server for advanced create support and cost (no charge, no DB write)
	router.post("/api/create/query", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const { server_id, args } = req.body;
		const safeArgs = args && typeof args === "object" ? { ...args } : {};

		if (!server_id) {
			return res.status(400).json({ error: "Missing required fields", message: "server_id is required" });
		}

		try {
			const server = await queries.selectServerById.get(server_id);
			if (!server) return res.status(404).json({ error: "Server not found" });
			if (server.status !== "active") return res.status(400).json({ error: "Server is not active" });

			// Backend builds items from boolean args and sends that to the provider; include extra args (e.g. prompt)
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
			const clipResolved = await resolveAudioClipProviderArgs(
				queries,
				user.id,
				extraArgs,
				getShareBaseUrl()
			);
			if (!clipResolved.ok) {
				return res.status(clipResolved.status).json({ error: clipResolved.error });
			}
			const providerArgs = { items, ...clipResolved.args };

			const providerResponse = await fetch(server.server_url, {
				method: "POST",
				headers: buildProviderHeaders(
					{ "Content-Type": "application/json", Accept: "application/json" },
					server.auth_token,
					server.server_config?.custom_headers
				),
				body: JSON.stringify({ method: "advanced_query", args: providerArgs }),
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
	});

	// POST /api/create/landscape/query - Query cost for landscape (outpaint) for a creation. Owner only.
	router.post("/api/create/landscape/query", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const creation_id = req.body?.creation_id;
		if (!creation_id) {
			return res.status(400).json({ error: "Missing required fields", message: "creation_id is required" });
		}

		const creationId = Number(creation_id);
		if (!Number.isFinite(creationId) || creationId <= 0) {
			return res.status(400).json({ error: "Invalid creation_id" });
		}

		const image = await queries.selectCreatedImageById.get(creationId, user.id);
		if (!image) {
			return res.status(404).json({ error: "Creation not found" });
		}
		if (image.status !== "completed" || !image.filename) {
			return res.status(400).json({ error: "Creation is not ready for landscape" });
		}

		const storageFilename = resolveCreatedImageStorageFilename(image);
		if (!storageFilename) {
			return res.json({
				supported: false,
				message: "Could not resolve image file for landscape.",
			});
		}

		const landscapeEligibility = getLandscapeOutpaintEligibility(image);
		if (!landscapeEligibility.eligible) {
			return res.json({
				supported: false,
				message: landscapeEligibility.reason || "Landscape is not supported for this creation.",
			});
		}

		let server = null;
		const meta = parseMeta(image.meta) || {};
		if (meta.server_id && Number.isFinite(Number(meta.server_id))) {
			server = await queries.selectServerById.get(Number(meta.server_id));
		}
		if (!server || server.status !== "active") {
			const allServers = (await queries.selectServers?.all?.()) ?? [];
			server = allServers.find((s) => s.status === "active") ?? null;
		}
		if (!server) {
			return res.status(400).json({ error: "No server available", message: "No active server available for landscape." });
		}

		const imageUrl = shareUrlForImage(creationId, user.id);
		if (!imageUrl) {
			return res.status(500).json({ error: "Failed to build image URL", message: "Could not generate share URL for provider." });
		}

		try {
			const providerArgs = { operation: "outpaint", image_url: imageUrl };
			const providerResponse = await fetch(server.server_url, {
				method: "POST",
				headers: buildProviderHeaders(
					{ "Content-Type": "application/json", Accept: "application/json" },
					server.auth_token,
					server.server_config?.custom_headers
				),
				body: JSON.stringify({ method: "advanced_query", args: providerArgs }),
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
				error: "Landscape query failed",
				message: err?.message || "Failed to query server"
			});
		}
	});

	// POST /api/create/landscape - Start landscape (outpaint) job. Owner only. Deducts credits, sets meta.landscapeUrl = "loading", enqueues job.
	router.post("/api/create/landscape", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const creation_id = req.body?.creation_id;
		const credit_cost = req.body?.credit_cost;
		if (!creation_id) {
			return res.status(400).json({ error: "Missing required fields", message: "creation_id is required" });
		}
		if (typeof credit_cost !== "number" || !Number.isFinite(credit_cost) || credit_cost <= 0) {
			return res.status(400).json({ error: "Missing required fields", message: "credit_cost is required and must be a positive number" });
		}

		const creationId = Number(creation_id);
		if (!Number.isFinite(creationId) || creationId <= 0) {
			return res.status(400).json({ error: "Invalid creation_id" });
		}

		const image = await queries.selectCreatedImageById.get(creationId, user.id);
		if (!image) {
			return res.status(404).json({ error: "Creation not found" });
		}
		if (image.status !== "completed" || !image.filename) {
			return res.status(400).json({ error: "Creation is not ready for landscape" });
		}

		const storageFilename = resolveCreatedImageStorageFilename(image);
		if (!storageFilename) {
			return res.status(400).json({
				error: "No image file",
				message: "Could not resolve image file for landscape.",
			});
		}

		const landscapeEligibility = getLandscapeOutpaintEligibility(image);
		if (!landscapeEligibility.eligible) {
			return res.status(400).json({
				error: "Landscape not supported",
				message: landscapeEligibility.reason || "Landscape is not supported for this creation.",
			});
		}

		const existingMeta = parseMeta(image.meta) || {};
		if (existingMeta.landscapeUrl === "loading") {
			return res.status(409).json({ error: "Landscape in progress", message: "A landscape is already being generated." });
		}

		let server = null;
		if (existingMeta.server_id && Number.isFinite(Number(existingMeta.server_id))) {
			server = await queries.selectServerById.get(Number(existingMeta.server_id));
		}
		if (!server || server.status !== "active") {
			const allServers = (await queries.selectServers?.all?.()) ?? [];
			server = allServers.find((s) => s.status === "active") ?? null;
		}
		if (!server) {
			return res.status(400).json({ error: "No server available", message: "No active server available for landscape." });
		}

		const imageUrl = shareUrlForImage(creationId, user.id);
		if (!imageUrl) {
			return res.status(500).json({ error: "Failed to build image URL", message: "Could not generate share URL for provider." });
		}

		let credits = await queries.selectUserCredits.get(user.id);
		if (!credits) {
			await queries.insertUserCredits.run(user.id, 100, null);
			credits = await queries.selectUserCredits.get(user.id);
		}
		if (!credits || credits.balance < credit_cost) {
			return res.status(402).json({
				error: "Insufficient credits",
				message: `Landscape requires ${credit_cost} credits. You have ${credits?.balance ?? 0} credits.`,
				required: credit_cost,
				current: credits?.balance ?? 0
			});
		}

		const nextMeta = { ...existingMeta, landscapeUrl: "loading" };
		await queries.updateCreatedImageMeta.run(creationId, user.id, nextMeta);
		await queries.updateUserCreditsBalance.run(user.id, -credit_cost);

		await scheduleLandscapeJob({
			payload: {
				created_image_id: creationId,
				user_id: user.id,
				server_id: server.id,
				image_url: imageUrl,
				credit_cost
			},
			runLandscapeJob: ({ payload }) => runLandscapeJob({ queries, storage, payload })
		});

		const updatedCredits = await queries.selectUserCredits.get(user.id);
		return res.json({
			ok: true,
			credits_remaining: updatedCredits?.balance ?? credits?.balance ?? 0
		});
	});

	router.post("/api/create/validate", async (req, res) => {
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
	});

	// POST /api/create - Create a new image (accepts JSON or multipart with optional image_file)
	router.post("/api/create", async (req, res) => {
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

			const clipResolved = await resolveAudioClipProviderArgs(
				queries,
				user.id,
				argsForProvider,
				getShareBaseUrl()
			);
			if (!clipResolved.ok) {
				return res.status(clipResolved.status).json({
					error: clipResolved.error,
					message: clipResolved.error
				});
			}
			argsForProvider = clipResolved.args;

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
			const timeout_at = new Date(Date.now() + PROVIDER_TIMEOUT_MS + 2000).toISOString();
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
				timeout_at,
				credit_cost: CREATION_CREDIT_COST,
				...(styleForMeta ? { style: styleForMeta } : {}),
				...(originalPromptForMeta !== "" ? { user_prompt: originalPromptForMeta } : {}),
			};

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
			function filenameFromParasceneImageUrl(raw) {
				const normalized = toParasceneImageUrl(raw);
				if (!normalized) return null;
				try {
					const u = new URL(normalized);
					const path = u.pathname || "";
					// Backend serves at /api/images/created/*; normalize legacy /images/created/ paths from storage.
					const prefixWithApi = "/api/images/created/";
					const prefixNoApi = "/images/created/";
					if (path.startsWith(prefixWithApi)) return path.slice(prefixWithApi.length) || null;
					if (path.startsWith(prefixNoApi)) return path.slice(prefixNoApi.length) || null;
					return null;
				} catch {
					return null;
				}
			}
			async function replaceUnpublishedUrlWithShareUrl(url) {
				const filename = filenameFromParasceneImageUrl(url);
				if (!filename || !queries.selectCreatedImageByFilename?.get) {
					return toParasceneImageUrl(url) || url;
				}
				const image = await queries.selectCreatedImageByFilename.get(filename);
				if (!image) {
					return toParasceneImageUrl(url) || url;
				}
				const isPublished = image.published === 1 || image.published === true;
				if (isPublished || (image.status || "") !== "completed" || !image.filename) {
					return toParasceneImageUrl(url) || url;
				}
				const isOwner = image.user_id === user.id;
				const isAdmin = user.role === "admin";
				if (!isOwner && !isAdmin) {
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
				if (status === "creating") {
					const existingMeta = parseMeta(image.meta) || {};
					const timeoutAt = existingMeta.timeout_at ? new Date(existingMeta.timeout_at).getTime() : NaN;
					if (!Number.isFinite(timeoutAt) || Date.now() <= timeoutAt) {
						return res.status(400).json({
							error: "Cannot retry",
							message: "Creation is still in progress"
						});
					}
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

			const updatedCredits = await queries.selectUserCredits.get(user.id);

			return res.json({
				id: createdImageId,
				status: "creating",
				created_at: started_at,
				meta,
				credits_remaining: updatedCredits?.balance ?? 0
			});
		} catch (error) {
			// console.error("Error initiating image creation:", error);
			return res.status(500).json({ error: "Failed to initiate image creation", message: error.message });
		}
	});

	router.post("/api/create/worker", async (req, res) => {
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
	});

	router.get("/api/create/images", async (req, res) => {
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

			const imagesWithUrls = (Array.isArray(images) ? images : []).map((img) => {
				const status = img.status || "completed";
				const meta = parseMeta(img.meta);
				const mediaFields =
					status === "completed"
						? mapCreatedImageRowMediaFields(img, { storage, includeMeta: false })
						: {
							url: null,
							thumbnail_url: null,
							fit_thumbnail_url: null,
							video_url: null,
							media_type: typeof meta?.media_type === "string" ? meta.media_type : "image"
						};

				return {
					id: img.id,
					filename: img.filename,
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
					video_url: mediaFields.video_url
				};
			});

			const filtered = enableNsfw ? imagesWithUrls : imagesWithUrls.filter((img) => !img.nsfw);
			const has_more = images.length === pageLimit;

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
	});

	// GET /api/create/images/:groupId/mutate-source?source_id= — group-first mutate bootstrap (avoids archived-source delegation).
	router.get("/api/create/images/:id/mutate-source", async (req, res) => {
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
	});

	// GET /api/create/images/:id - Get specific image metadata
	router.get("/api/create/images/:id", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			// First try to get as owner
			let image = await queries.selectCreatedImageById.get(
				req.params.id,
				user.id
			);

			let shareAccess = null;
			let lineageMediaParentId = null;
			let challengeMediaMessageId = null;
			let challengeHeroId = null;

			// If not found as owner, check if it exists and is either published or user is admin
			if (!image) {
				const anyImage = await queries.selectCreatedImageByIdAnyUser.get(req.params.id);
				if (anyImage) {
					const isPublished = anyImage.published === 1 || anyImage.published === true;
					const isAdmin = user.role === 'admin';
					const isUnavailable = anyImage.unavailable_at != null && anyImage.unavailable_at !== "";
					// Optional: allow view-only access via external share token (for signed-in non-owners).
					if (!isPublished && !isAdmin) {
						let shareVersion = String(req.headers["x-share-version"] || "");
						let shareToken = String(req.headers["x-share-token"] || "");
						if (shareVersion && shareToken) {
							const verified = verifyShareToken({ version: shareVersion, token: shareToken });
							if (verified.ok && Number(verified.imageId) === Number(anyImage.id)) {
								const status = anyImage.status || "completed";
								if (status === "completed" && !isUnavailable) {
									shareAccess = { version: shareVersion, token: shareToken };
									image = anyImage;
								}
							}
						}
					}

					// Unpublished ancestor visible when listed in lineage of a viewable parent (see canViewUnpublishedCreationViaLineageDelegation).
					if (!image) {
						const lo = req.query?.lineage_of;
						const lineagePid = typeof lo === "string" ? parseInt(lo, 10) : Number(lo);
						if (Number.isFinite(lineagePid) && lineagePid > 0) {
							const ok = await canViewUnpublishedCreationViaLineageDelegation({
								ancestorRow: anyImage,
								lineageParentId: lineagePid,
								viewerUserId: user.id,
								viewerRole: user.role
							});
							if (ok) {
								image = anyImage;
								lineageMediaParentId = lineagePid;
							}
						}
					}

					// Blind-vote submissions are unpublished — allow viewers in #challenges when message id proves entry.
					if (!image && !isUnavailable) {
						const cmRaw = req.query?.challenge_message_id ?? req.query?.challenge_msg;
						const chMid =
							typeof cmRaw === "string" ? parseInt(cmRaw, 10) : Number(cmRaw);
						if (Number.isFinite(chMid) && chMid > 0) {
							const sbVote = getSupabaseServiceClient();
							if (sbVote) {
								try {
									const voteOk = await canViewUnpublishedCreationViaChallengeMessage(sbVote, {
										ancestorRow: anyImage,
										challengeMessageId: chMid,
										viewerUserId: user.id
									});
									if (voteOk) {
										image = anyImage;
										challengeMediaMessageId = chMid;
									}
								} catch {
									// ignore
								}
							}
						}
					}

					// Challenge hero images may reference unpublished organizer creations.
					if (!image && !isUnavailable) {
						const chIdRaw = req.query?.challenge_id;
						const chId =
							typeof chIdRaw === "string" ? chIdRaw.trim() : String(chIdRaw || "").trim();
						const sbHero = getSupabaseServiceClient();
						if (sbHero) {
							try {
								const heroOk = await canViewUnpublishedCreationViaChallengeHero(sbHero, {
									ancestorRow: anyImage,
									challengeId: chId || undefined,
									viewerUserId: user.id
								});
								if (heroOk) {
									image = anyImage;
									if (chId) challengeHeroId = chId;
								}
							} catch {
								// ignore
							}
						}
					}

					if (!image && (isPublished || isAdmin) && !isUnavailable) {
						image = anyImage;
					} else if (!image && isAdmin && isUnavailable) {
						image = anyImage;
					} else if (!image) {
						const groupPid = parsePositiveIntQuery(req.query?.group_of ?? req.query?.group_id);
						if (groupPid) {
							const delegationOk = await canViewUnpublishedCreationViaCreationDelegation({
								ancestorRow: anyImage,
								creationId: groupPid,
								viewerUserId: user.id,
								viewerRole: user.role
							});
							if (delegationOk) {
								image = anyImage;
							}
						}
						if (!image) {
							return res.status(404).json({ error: "Image not found" });
						}
					}
				} else {
					return res.status(404).json({ error: "Image not found" });
				}
			}

			// Archived rows: allow lineage context or group parent (group owner may mutate party sources in group).
			const isOwner = viewerOwnsCreationRow(image, user.id);
			const isAdmin = user.role === "admin";
			const isUnavailable = image.unavailable_at != null && image.unavailable_at !== "";
			let unavailableContextBypass = false;
			if (isOwner && !isAdmin && isUnavailable) {
				const lineagePid = parsePositiveIntQuery(req.query?.lineage_of);
				if (lineagePid) {
					const parentRow = await queries.selectCreatedImageById.get(lineagePid, user.id);
					if (parentRow) {
						const pm = parseMeta(parentRow.meta);
						const allowed = collectLineageAncestorIdsFromParentMeta(pm);
						if (allowed.has(Number(image.id)) && viewerOwnsCreationRow(parentRow, user.id)) {
							unavailableContextBypass = true;
							lineageMediaParentId = lineagePid;
						}
					}
				}
			}
			if (!isAdmin && isUnavailable && !unavailableContextBypass) {
				const groupPid = parsePositiveIntQuery(req.query?.group_of ?? req.query?.group_id);
				if (
					groupPid &&
					(await canViewUnavailableImageViaGroupParent({
						imageRow: image,
						groupParentId: groupPid,
						viewerUserId: user.id
					}))
				) {
					unavailableContextBypass = true;
				}
			}
			if (!isAdmin && isUnavailable && !unavailableContextBypass) {
				return res.status(404).json({ error: "Image not found" });
			}

			// Get user information for the creator
			let creator = null;
			if (image.user_id) {
				creator = await queries.selectUserById.get(image.user_id);
			}
			const creatorProfile = image.user_id
				? await queries.selectUserProfileByUserId.get(image.user_id).catch(() => null)
				: null;

			const likeCountRow = await queries.selectCreatedImageLikeCount?.get(image.id);
			const likeCount = Number(likeCountRow?.like_count ?? 0);
			const viewerLikedRow = await queries.selectCreatedImageViewerLiked?.get(user.id, image.id);
			const viewerLiked = Boolean(viewerLikedRow?.viewer_liked);

			const isPublished = image.published === 1 || image.published === true;
			// Always read description from created_image, not from feed_item
			// (feed_item may be deleted when un-publishing)
			const description = typeof image.description === "string" ? image.description.trim() : "";
			const meta = parseMeta(image.meta);

			const status = image.status || 'completed';
			const creationIdForMedia = Number(image.id);
			let url = null;
			if (status === "completed") {
				if (shareAccess) {
					url = `/api/share/${encodeURIComponent(shareAccess.version)}/${encodeURIComponent(shareAccess.token)}/image`;
				} else {
					const mediaFields = mapCreatedImageRowMediaFields(image, { storage, includeMeta: false });
					url = mediaFields.url;
				}
			}

			const appendLineageToMediaUrls =
				lineageMediaParentId != null &&
				!isPublished &&
				!isOwner &&
				!shareAccess &&
				status === "completed";

			const appendChallengeToMediaUrls =
				challengeMediaMessageId != null &&
				!isPublished &&
				!isOwner &&
				!shareAccess &&
				status === "completed";

			const appendChallengeHeroToMediaUrls =
				challengeHeroId != null &&
				!isPublished &&
				!isOwner &&
				!shareAccess &&
				status === "completed";

			if (url && appendLineageToMediaUrls) {
				url = appendLineageOfToMediaUrl(url, lineageMediaParentId);
			}
			if (url && appendChallengeToMediaUrls) {
				url = appendChallengeMessageIdToMediaUrl(url, challengeMediaMessageId);
			}
			if (url && appendChallengeHeroToMediaUrls) {
				url = appendChallengeIdToMediaUrl(url, challengeHeroId);
			}

			const mediaType = typeof meta?.media_type === "string" ? meta.media_type : "image";
			const videoMeta = meta && typeof meta === "object" ? meta.video : null;
			const videoUrlRaw =
				videoMeta && typeof videoMeta.file_path === "string" && videoMeta.file_path
					? videoMeta.file_path
					: null;
			let videoUrl =
				shareAccess && mediaType === "video" && videoUrlRaw
					? `/api/share/${encodeURIComponent(shareAccess.version)}/${encodeURIComponent(shareAccess.token)}/video`
					: videoUrlRaw;
			if (videoUrl && !shareAccess) {
				videoUrl = appendCreationIdToMediaUrl(videoUrl, creationIdForMedia);
			}
			if (videoUrl && appendLineageToMediaUrls) {
				videoUrl = appendLineageOfToMediaUrl(videoUrl, lineageMediaParentId);
			}
			if (videoUrl && appendChallengeToMediaUrls) {
				videoUrl = appendChallengeMessageIdToMediaUrl(videoUrl, challengeMediaMessageId);
			}
			if (videoUrl && appendChallengeHeroToMediaUrls) {
				videoUrl = appendChallengeIdToMediaUrl(videoUrl, challengeHeroId);
			}
			const sourceImageUrl =
				typeof meta?.source_image_url === "string" && meta.source_image_url
					? meta.source_image_url
					: null;

			// If creation is NSFW and viewer has not enabled NSFW, return not found (owners and admins may still view).
			const isNsfw = !!meta?.nsfw;
			const viewerEnableNsfw = user.meta?.enableNsfw === true;
			if (isNsfw && !viewerEnableNsfw && image.user_id !== user.id && user.role !== 'admin') {
				return res.status(404).json({ error: "Image not found" });
			}

			// When creation was mutated from another, expose parent's NSFW so publish modal can auto-tick when appropriate.
			let mutateOfNsfw = null;
			const mutateOfId = meta?.mutate_of_id != null ? Number(meta.mutate_of_id) : NaN;
			if (Number.isFinite(mutateOfId) && mutateOfId > 0) {
				try {
					const parentRow = await queries.selectCreatedImageByIdAnyUser?.get(mutateOfId);
					if (parentRow?.meta) {
						const parentMeta = parseMeta(parentRow.meta);
						mutateOfNsfw = !!(parentMeta?.nsfw);
					}
				} catch {
					// ignore; mutate_of_nsfw stays null
				}
			}

			const response = {
				id: image.id,
				filename: image.filename,
				url, // Use stored URL or generate one
				thumbnail_url: url ? getThumbnailUrl(url) : null,
				width: image.width,
				height: image.height,
				color: image.color,
				status,
				created_at: image.created_at,
				published: isPublished,
				published_at: image.published_at || null,
				title: image.title || null,
				description: description || null,
				like_count: likeCount,
				viewer_liked: viewerLiked,
				user_id: image.user_id,
				meta: shareAccess
					? rewriteGroupMetaForShareAccess(meta, shareAccess, creationIdForMedia)
					: meta,
				nsfw: !!meta?.nsfw,
				is_moderated_error: isModeratedError(status, meta),
				media_type: mediaType,
				video_url: videoUrl,
				source_image_url: sourceImageUrl,
				creator: creator ? {
					id: creator.id,
					email: creator.email,
					role: creator.role,
					user_name: creatorProfile?.user_name ?? null,
					display_name: creatorProfile?.display_name ?? null,
					avatar_url: creatorProfile?.avatar_url ?? null,
					plan: creator.meta?.plan === 'founder' ? 'founder' : 'free'
				} : null
			};
			if (mutateOfNsfw !== null) {
				response.mutate_of_nsfw = mutateOfNsfw;
			}
			if (isAdmin && isUnavailable) {
				response.user_deleted = true;
			}
			await appendChallengeSubmitEligibility(req, user, image, meta, response);

			if (Array.isArray(meta?.challenge_submissions) && meta.challenge_submissions.length > 0) {
				try {
					const sbEntry = getSupabaseServiceClient();
					const summary = await summarizeChallengeSubmissionPhases({ sb: sbEntry, meta });
					response.challenge_entry = {
						has_submission: summary.hasSubmission,
						all_ended: summary.allEnded,
						any_active: summary.anyActive,
						entries: summary.entries
					};
				} catch {
					// On failure, fall back to "active" so publishing stays gated.
					response.challenge_entry = {
						has_submission: true,
						all_ended: false,
						any_active: true,
						entries: []
					};
				}
			}

			try {
				response.lineage_descendants = await buildLineageDescendantsForParent(image.id, user);
			} catch {
				response.lineage_descendants = [];
			}

			if (queries.acknowledgeNotificationsForUserAndCreation?.run) {
				const cid = Number(image.id);
				if (Number.isFinite(cid) && cid > 0) {
					void queries.acknowledgeNotificationsForUserAndCreation
						.run(user.id, user.role, cid)
						.catch(() => { });
				}
			}

			return res.json(response);
		} catch (error) {
			// console.error("Error fetching image:", error);
			return res.status(500).json({ error: "Failed to fetch image" });
		}
	});

	// POST /api/create/images/:id/challenge-submit — owner posts challenge_submission JSON to Challenges thread + records meta.challenge_submissions
	router.post("/api/create/images/:id/challenge-submit", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const imageId = Number(req.params.id);
		if (!Number.isFinite(imageId) || imageId <= 0) {
			return res.status(400).json({ error: "Invalid creation id" });
		}
		const threadId = Number(req.body?.thread_id ?? req.body?.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			return res.status(400).json({ error: "thread_id required" });
		}
		const noteRaw = req.body?.note;

		const sb = getSupabaseServiceClient();
		if (!sb) {
			return res.status(503).json({ error: "Service unavailable", message: "Database not configured" });
		}

		try {
			const image = await queries.selectCreatedImageById.get(imageId, user.id);
			if (!image) {
				return res.status(404).json({ error: "Image not found" });
			}

			const meta = parseMeta(image.meta) || {};
			const status = image.status || "completed";
			const pub = image.published === 1 || image.published === true;
			if (status !== "completed") {
				return res.status(400).json({ error: "Creation must be finished before entering a challenge." });
			}
			if (pub) {
				return res.status(400).json({
					error: "Published creations cannot be submitted to a challenge. Un-publish first if allowed."
				});
			}
			if (meta?.group?.kind === "group_creations") {
				return res.status(400).json({ error: "Group creations cannot be submitted as one challenge entry." });
			}

			const v = await validateChallengeSubmission({
				sb,
				userId: user.id,
				ownerUserId: image.user_id,
				creationId: imageId,
				meta,
				threadId,
				note: noteRaw
			});
			if (!v.ok) {
				return res.status(v.status).json({ error: v.message });
			}

			const payload = {
				kind: "challenge_submission",
				challenge_id: v.challengeId,
				created_image_id: imageId,
				...(v.noteTrim ? { note: v.noteTrim } : {})
			};
			let body = JSON.stringify(payload);
			if (body.length > MAX_CHALLENGE_CHAT_BODY_CHARS) {
				return res.status(400).json({ error: "Submission payload too large" });
			}

			const ins = await sb
				.from("prsn_chat_messages")
				.insert({ thread_id: threadId, sender_id: user.id, body })
				.select("id, thread_id, sender_id, body, created_at")
				.single();

			if (ins.error) throw ins.error;

			const newMsgId = ins.data?.id != null ? Number(ins.data.id) : null;

			const existingSubs = Array.isArray(meta.challenge_submissions) ? [...meta.challenge_submissions] : [];
			existingSubs.push({
				thread_id: threadId,
				challenge_id: v.challengeId,
				message_id: Number.isFinite(newMsgId) && newMsgId > 0 ? newMsgId : null,
				submitted_at: new Date().toISOString()
			});
			const nextMeta = { ...meta, challenge_submissions: existingSubs };
			const up = await queries.updateCreatedImageMeta.run(imageId, user.id, nextMeta);
			if (!up || up.changes === 0) {
				console.error("[POST challenge-submit] meta update failed after message insert", imageId);
				return res.status(500).json({
					error: "Posted to the challenge channel but could not update creation metadata.",
					message: ins.data
				});
			}

			if (ins.data?.id != null) {
				const newId = Number(ins.data.id);
				if (Number.isFinite(newId) && newId > 0) {
					const { error: readErr } = await sb
						.from("prsn_chat_members")
						.update({ last_read_message_id: newId })
						.eq("thread_id", threadId)
						.eq("user_id", user.id);
					if (readErr) throw readErr;
				}
				void broadcastRoomDirty(threadId, ins.data.id);
				const [memRes, threadRes] = await Promise.all([
					sb.from("prsn_chat_members").select("user_id").eq("thread_id", threadId),
					sb.from("prsn_chat_threads").select("type, channel_slug, dm_pair_key").eq("id", threadId).maybeSingle()
				]);
				const uids = Array.isArray(memRes.data) ? memRes.data.map((r) => r.user_id) : [];
				void broadcastUserInboxDirty(threadId, uids);
				void insertNotificationsForChatMentions({
					queries,
					memberUserIds: uids,
					threadId,
					threadType: threadRes.data?.type,
					channelSlug: threadRes.data?.channel_slug,
					dmPairKey: threadRes.data?.dm_pair_key,
					senderId: user.id,
					body
				});
			}

			return res.status(201).json({
				ok: true,
				message: ins.data,
				meta: nextMeta
			});
		} catch (err) {
			console.error("[POST /api/create/images/:id/challenge-submit]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// POST /api/create/images/:id/challenge-withdraw — owner removes challenge entries tied to #challenges (meta + chat message)
	router.post("/api/create/images/:id/challenge-withdraw", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const imageId = Number(req.params.id);
		if (!Number.isFinite(imageId) || imageId <= 0) {
			return res.status(400).json({ error: "Invalid creation id" });
		}

		const sb = getSupabaseServiceClient();
		if (!sb) {
			return res.status(503).json({ error: "Service unavailable", message: "Database not configured" });
		}

		try {
			const image = await queries.selectCreatedImageById.get(imageId, user.id);
			if (!image) {
				return res.status(404).json({ error: "Image not found" });
			}

			const meta = parseMeta(image.meta) || {};
			const subs = Array.isArray(meta.challenge_submissions) ? [...meta.challenge_submissions] : [];
			if (subs.length === 0) {
				return res.status(400).json({ error: "This creation is not entered in a challenge." });
			}

			const canonicalTid = await findChallengesChannelThreadId(sb);
			const challengesThreadIds = new Set();
			if (canonicalTid != null) challengesThreadIds.add(canonicalTid);

			const uniqueTids = [
				...new Set(
					subs
						.map((s) => Number(s?.thread_id))
						.filter((n) => Number.isFinite(n) && n > 0)
				)
			];
			for (const tid of uniqueTids) {
				if (challengesThreadIds.has(tid)) continue;
				const row = await fetchChatChannelThreadRow(sb, tid);
				if (
					row &&
					row.type === "channel" &&
					String(row.channel_slug || "").toLowerCase() === "challenges"
				) {
					challengesThreadIds.add(tid);
				}
			}

			const inChallengesChannel = (s) => challengesThreadIds.has(Number(s?.thread_id));

			// Entries whose challenge has ended can no longer be removed (permanent record).
			let endedEntryKeys = new Set();
			try {
				const summary = await summarizeChallengeSubmissionPhases({ sb, meta });
				for (const e of summary.entries) {
					if (e.ended) {
						endedEntryKeys.add(`${Number(e.thread_id)}::${String(e.challenge_id || "").trim()}`);
					}
				}
			} catch {
				endedEntryKeys = new Set();
			}
			const entryKey = (s) =>
				`${Number(s?.thread_id)}::${String(s?.challenge_id || "").trim()}`;
			const isEnded = (s) => endedEntryKeys.has(entryKey(s));

			const channelEntries = subs.filter(inChallengesChannel);
			if (channelEntries.length === 0) {
				return res.status(400).json({ error: "No challenge entry found for the community Challenges channel." });
			}

			// Only active challenge entries are removable; ended entries stay in meta.
			const toRemove = channelEntries.filter((s) => !isEnded(s));
			const nextSubs = subs.filter((s) => !inChallengesChannel(s) || isEnded(s));

			if (toRemove.length === 0) {
				return res.status(400).json({
					error: "This challenge has ended, so this entry can no longer be removed."
				});
			}

			for (const r of toRemove) {
				const tid = Number(r.thread_id);
				const mid = Number(r.message_id);
				if (!Number.isFinite(mid) || mid <= 0 || !Number.isFinite(tid) || tid <= 0) continue;
				await sb
					.from("prsn_chat_messages")
					.delete()
					.eq("id", mid)
					.eq("sender_id", user.id)
					.eq("thread_id", tid);
			}

			const nextMeta = { ...meta, challenge_submissions: nextSubs };
			const up = await queries.updateCreatedImageMeta.run(imageId, user.id, nextMeta);
			if (!up || up.changes === 0) {
				console.error("[POST challenge-withdraw] meta update failed", imageId);
				return res.status(500).json({ error: "Could not update creation metadata." });
			}

			const touchedThreads = [
				...new Set(
					toRemove
						.map((x) => Number(x.thread_id))
						.filter((n) => Number.isFinite(n) && n > 0)
				)
			];
			for (const tid of touchedThreads) {
				const { data: lastRow } = await sb
					.from("prsn_chat_messages")
					.select("id")
					.eq("thread_id", tid)
					.order("created_at", { ascending: false })
					.limit(1)
					.maybeSingle();
				const lastId = Number(lastRow?.id);
				if (Number.isFinite(lastId) && lastId > 0) {
					void broadcastRoomDirty(tid, lastId);
				}
				const memRes = await sb.from("prsn_chat_members").select("user_id").eq("thread_id", tid);
				const uids = Array.isArray(memRes.data) ? memRes.data.map((row) => row.user_id) : [];
				void broadcastUserInboxDirty(tid, uids);
			}

			return res.status(200).json({ ok: true, meta: nextMeta });
		} catch (err) {
			console.error("[POST /api/create/images/:id/challenge-withdraw]", err);
			return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
		}
	});

	// GET /api/create/images/:id/children - Lineage descendants (direct + indirect), ordered by created_at
	router.get("/api/create/images/:id/children", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const parentId = Number(req.params.id);
			if (!Number.isFinite(parentId) || parentId <= 0) {
				return res.status(400).json({ error: "Invalid creation id" });
			}

			const descendants = await buildLineageDescendantsForParent(parentId, user);
			return res.json({ descendants });
		} catch (error) {
			return res.status(500).json({ error: "Failed to fetch children" });
		}
	});

	// POST /api/create/images/:id/share - Mint an external share URL (no DB write)
	router.post("/api/create/images/:id/share", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const id = Number(req.params.id);
			if (!Number.isFinite(id) || id <= 0) {
				return res.status(400).json({ error: "Invalid creation id" });
			}

			// First try as owner.
			let image = await queries.selectCreatedImageById?.get(id, user.id);

			// If not owner, allow if published or admin.
			if (!image) {
				const any = await queries.selectCreatedImageByIdAnyUser?.get(id);
				if (!any) {
					return res.status(404).json({ error: "Image not found" });
				}
				const isPublished = any.published === 1 || any.published === true;
				const isAdmin = user.role === "admin";
				if (!isPublished && !isAdmin) {
					return res.status(404).json({ error: "Image not found" });
				}
				image = any;
			}

			const status = image.status || "completed";
			if (status !== "completed") {
				return res.status(400).json({ error: "Only completed images can be shared" });
			}

			const token = mintShareToken({
				version: ACTIVE_SHARE_VERSION,
				imageId: id,
				sharedByUserId: Number(user.id)
			});
			const bust = Math.floor(Date.now() / 1000).toString(36);
			const url = `${getShareBaseUrl()}/s/${ACTIVE_SHARE_VERSION}/${token}/${bust}`;
			return res.json({ url });
		} catch (error) {
			return res.status(500).json({ error: "Failed to mint share link" });
		}
	});

	// GET /api/create/images/:id/image - Original creation image (still frame for videos) for device share/save.
	router.get("/api/create/images/:id/image", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const id = Number(req.params.id);
			const resolved = await resolveCreationImageForExport({ queries, creationId: id, user });
			if (!resolved.ok) {
				return res.status(resolved.status).json({ error: resolved.error });
			}
			const image = resolved.image;

			const storageFilename = resolveCreatedImageStorageFilename(image);
			if (!storageFilename) {
				return res.status(400).json({ error: "Image file missing" });
			}

			const sourceBuf = await storage.getImageBuffer(storageFilename);
			if (!sourceBuf || !Buffer.isBuffer(sourceBuf)) {
				return res.status(500).json({ error: "Failed to read image" });
			}

			const contentType = guessImageContentType(storageFilename);
			const suffix =
				contentType === "image/jpeg"
					? ".jpg"
					: contentType === "image/webp"
						? ".webp"
						: contentType === "image/gif"
							? ".gif"
							: ".png";
			const downloadName = `parascene-${id}${suffix}`;

			res.set("Cache-Control", "private, no-store, max-age=0");
			res.set("Content-Type", contentType);
			res.set("Content-Length", String(sourceBuf.length));
			res.set("Content-Disposition", `inline; filename="${downloadName}"`);
			return res.send(sourceBuf);
		} catch (error) {
			const status =
				error && typeof error === "object" && "status" in error && typeof error.status === "number"
					? error.status
					: 500;
			const msg = error instanceof Error && error.message ? error.message : "Failed to export image";
			if (status >= 400 && status < 600) {
				return res.status(status).json({ error: msg });
			}
			return res.status(500).json({ error: "Failed to export image" });
		}
	});

	// GET /api/create/images/:id/watermarked - Open a watermarked image export for manual sharing/copying.
	router.get("/api/create/images/:id/watermarked", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const id = Number(req.params.id);
			if (!Number.isFinite(id) || id <= 0) {
				return res.status(400).json({ error: "Invalid creation id" });
			}

			// First try as owner.
			let image = await queries.selectCreatedImageById?.get(id, user.id);

			// If not owner, allow if published or admin.
			if (!image) {
				const any = await queries.selectCreatedImageByIdAnyUser?.get(id);
				if (!any) {
					return res.status(404).json({ error: "Image not found" });
				}
				const isPublished = any.published === 1 || any.published === true;
				const isAdmin = user.role === "admin";
				if (!isPublished && !isAdmin) {
					return res.status(404).json({ error: "Image not found" });
				}
				image = any;
			}

			const status = image.status || "completed";
			if (status !== "completed") {
				return res.status(400).json({ error: "Only completed images can be exported" });
			}
			if (creationRowIsVideo(image.meta)) {
				return res.status(400).json({ error: "Video creations are not supported for watermarked export" });
			}
			const storageFilename = resolveCreatedImageStorageFilename(image);
			if (!storageFilename) {
				return res.status(400).json({ error: "Image file missing" });
			}

			const sourceBuf = await storage.getImageBuffer(storageFilename);
			if (!sourceBuf || !Buffer.isBuffer(sourceBuf)) {
				return res.status(500).json({ error: "Failed to read image" });
			}

			const wm = await applyVynlyShareWatermark(sourceBuf);
			const outBuf = wm?.buffer && Buffer.isBuffer(wm.buffer) ? wm.buffer : sourceBuf;
			const contentType =
				typeof wm?.contentType === "string" && wm.contentType ? wm.contentType : guessImageContentType(storageFilename);
			const suffix =
				typeof wm?.filenameSuffix === "string" && wm.filenameSuffix
					? wm.filenameSuffix
					: contentType === "image/jpeg"
						? ".jpg"
						: contentType === "image/webp"
							? ".webp"
							: contentType === "image/gif"
								? ".gif"
								: ".png";

			const downloadName = `parascene-${id}-watermarked${suffix}`;

			res.set("Cache-Control", "private, no-store, max-age=0");
			res.set("Content-Type", contentType);
			res.set("Content-Length", String(outBuf.length));
			res.set("Content-Disposition", `inline; filename="${downloadName}"`);
			return res.send(outBuf);
		} catch (error) {
			const status =
				error && typeof error === "object" && "status" in error && typeof error.status === "number"
					? error.status
					: 500;
			const msg = error instanceof Error && error.message ? error.message : "Failed to export watermarked image";
			if (status >= 400 && status < 600) {
				return res.status(status).json({ error: msg });
			}
			return res.status(500).json({ error: "Failed to export watermarked image" });
		}
	});

	// POST /api/create/images/:id/retry - "Retry" means: mark stale creating as failed (no provider retry)
	router.post("/api/create/images/:id/retry", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const image = await queries.selectCreatedImageById.get(req.params.id, user.id);
			if (!image) {
				return res.status(404).json({ error: "Image not found" });
			}

			const meta = parseMeta(image.meta) || {};
			const status = image.status || "completed";
			const timeoutAt = meta?.timeout_at ? new Date(meta.timeout_at).getTime() : NaN;
			const isPastTimeout = Number.isFinite(timeoutAt) && Date.now() > timeoutAt;

			if (status === "completed") {
				return res.status(400).json({ error: "Cannot retry a completed image" });
			}

			if (status === "creating" && !isPastTimeout) {
				return res.status(400).json({ error: "Creation is still in progress" });
			}

			const nextMeta = {
				...meta,
				failed_at: nowIso(),
				error_code: meta?.error_code || (status === "creating" ? "timeout" : "provider_error"),
				error: meta?.error || (status === "creating" ? "Timed out" : "Failed"),
			};

			await queries.updateCreatedImageJobFailed.run(Number(req.params.id), user.id, { meta: nextMeta });

			// If it was stuck creating and credits were never refunded, refund once.
			const creditCost = Number(nextMeta?.credit_cost ?? 0);
			if (status === "creating" && creditCost > 0 && nextMeta.credits_refunded !== true) {
				await queries.updateUserCreditsBalance.run(user.id, creditCost);
				await queries.updateCreatedImageJobFailed.run(Number(req.params.id), user.id, {
					meta: { ...nextMeta, credits_refunded: true }
				});
			}

			return res.json({ ok: true });
		} catch (error) {
			// console.error("Error retrying image:", error);
			return res.status(500).json({ error: "Failed to retry image" });
		}
	});

	// POST /api/create/images/repair-group-aspect
	// Fix meta.args.aspect_ratio on group creations from the first source in the list.
	router.post("/api/create/images/repair-group-aspect", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const bodyIds = Array.isArray(req.body?.ids) ? req.body.ids : null;
			const limit = Math.min(100, Math.max(1, parseInt(req.body?.limit, 10) || 50));
			const updated = [];
			const skipped = [];

			/** @type {object[]} */
			let candidates = [];
			if (bodyIds && bodyIds.length > 0) {
				for (const rawId of bodyIds.slice(0, limit)) {
					const id = Number(rawId);
					if (!Number.isFinite(id) || id <= 0) continue;
					const row = await queries.selectCreatedImageById.get(id, user.id);
					if (row) candidates.push(row);
					else skipped.push({ id, reason: "not_found" });
				}
			} else {
				const pages = Math.ceil(limit / 50);
				for (let p = 0; p < pages && candidates.length < limit; p++) {
					const batch = await queries.selectCreatedImagesForUser.all(user.id, {
						limit: 50,
						offset: p * 50,
						viewerEnableNsfw: true
					});
					if (!Array.isArray(batch) || batch.length === 0) break;
					for (const row of batch) {
						const meta = parseMeta(row.meta);
						if (meta?.group?.kind === "group_creations") {
							candidates.push(row);
							if (candidates.length >= limit) break;
						}
					}
					if (batch.length < 50) break;
				}
			}

			for (const row of candidates) {
				const id = Number(row.id);
				const meta = parseMeta(row.meta) || {};
				if (meta?.group?.kind !== "group_creations") {
					skipped.push({ id, reason: "not_group" });
					continue;
				}
				const sources = Array.isArray(meta.group.source_creations)
					? meta.group.source_creations.filter((s) => s && typeof s === "object")
					: [];
				const firstId = Number(
					Array.isArray(meta.group.source_creation_ids)
						? meta.group.source_creation_ids[0]
						: NaN
				);
				const first =
					(Number.isFinite(firstId) && firstId > 0
						? sources.find((s) => Number(s.id) === firstId)
						: null) || sources[0] || null;
				if (!first) {
					skipped.push({ id, reason: "no_sources" });
					continue;
				}
				const nextAspect = aspectRatioForGroupFirstSource(first);
				const current =
					typeof meta?.args?.aspect_ratio === "string"
						? meta.args.aspect_ratio.trim()
						: "";
				if (current === nextAspect) {
					skipped.push({ id, reason: "already_ok", aspect_ratio: current });
					continue;
				}
				const nextMeta = withGroupAspectRatioFromFirst(meta, first);
				const result = await queries.updateCreatedImageMeta.run(id, user.id, nextMeta);
				if (!result || result.changes === 0) {
					skipped.push({ id, reason: "update_failed" });
					continue;
				}
				updated.push({ id, aspect_ratio: nextAspect, previous: current || null });
			}

			return res.json({
				ok: true,
				updated,
				skipped,
				updated_count: updated.length,
				skipped_count: skipped.length
			});
		} catch (error) {
			console.error("repair-group-aspect failed:", error);
			return res.status(500).json({ error: "Failed to repair group aspects" });
		}
	});

	// POST /api/create/images/repair-fit-thumbnails
	// Generate native-aspect fit thumbs for non-square creations missing a fit object.
	router.post("/api/create/images/repair-fit-thumbnails", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			if (typeof storage.uploadFitThumbnail !== "function") {
				return res.status(500).json({ error: "Fit thumbnail storage not available" });
			}
			const bodyIds = Array.isArray(req.body?.ids) ? req.body.ids : null;
			const limit = Math.min(50, Math.max(1, parseInt(req.body?.limit, 10) || 25));
			const force = req.body?.force === true;
			const updated = [];
			const skipped = [];

			/** @type {object[]} */
			let candidates = [];
			if (bodyIds && bodyIds.length > 0) {
				for (const rawId of bodyIds.slice(0, limit)) {
					const id = Number(rawId);
					if (!Number.isFinite(id) || id <= 0) continue;
					const row = await queries.selectCreatedImageById.get(id, user.id);
					if (row) candidates.push(row);
					else skipped.push({ id, reason: "not_found" });
				}
			} else {
				const pages = Math.ceil(limit / 50);
				for (let p = 0; p < pages && candidates.length < limit; p++) {
					const batch = await queries.selectCreatedImagesForUser.all(user.id, {
						limit: 50,
						offset: p * 50,
						viewerEnableNsfw: true
					});
					if (!Array.isArray(batch) || batch.length === 0) break;
					for (const row of batch) {
						if ((row.status || "completed") !== "completed") continue;
						candidates.push(row);
						if (candidates.length >= limit) break;
					}
					if (batch.length < 50) break;
				}
			}

			for (const row of candidates) {
				const id = Number(row.id);
				const w = Number(row.width);
				const h = Number(row.height);
				const meta = parseMeta(row.meta) || {};
				const dimsW = Number.isFinite(w) && w > 0 ? w : null;
				const dimsH = Number.isFinite(h) && h > 0 ? h : null;
				if (dimsW && dimsH && !shouldGenerateFitThumbnail(dimsW, dimsH)) {
					skipped.push({ id, reason: "square" });
					continue;
				}

				const storageFilename = resolveCreatedImageStorageFilename(row);
				if (!storageFilename) {
					skipped.push({ id, reason: "no_storage_filename" });
					continue;
				}

				if (!force && typeof storage.hasFitThumbnail === "function") {
					try {
						const exists = await storage.hasFitThumbnail(storageFilename);
						if (exists) {
							skipped.push({ id, reason: "already_exists" });
							continue;
						}
					} catch {
						// proceed to regenerate
					}
				}

				let fullBuffer;
				try {
					fullBuffer = await storage.getImageBuffer(storageFilename, {});
				} catch (e) {
					skipped.push({ id, reason: "media_missing", detail: e?.message || String(e) });
					continue;
				}

				// Re-check dims from bytes when row width/height missing or unreliable.
				try {
					const sharpMeta = await sharp(fullBuffer, { failOn: "none" }).metadata();
					const bw = Number(sharpMeta.width) || 0;
					const bh = Number(sharpMeta.height) || 0;
					if (bw > 0 && bh > 0 && !shouldGenerateFitThumbnail(bw, bh)) {
						skipped.push({ id, reason: "square" });
						continue;
					}
				} catch {
					// continue; buildFitThumbnailBuffer will fail clearly
				}

				try {
					await storage.uploadFitThumbnail(fullBuffer, storageFilename);
					updated.push({ id, filename: storageFilename });
				} catch (e) {
					skipped.push({ id, reason: "upload_failed", detail: e?.message || String(e) });
				}
			}

			return res.json({
				ok: true,
				updated,
				skipped,
				updated_count: updated.length,
				skipped_count: skipped.length
			});
		} catch (error) {
			console.error("repair-fit-thumbnails failed:", error);
			return res.status(500).json({ error: "Failed to repair fit thumbnails" });
		}
	});

	// POST /api/create/images/:id/fit-thumbnail — generate fit thumb for one creation.
	router.post("/api/create/images/:id/fit-thumbnail", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			if (typeof storage.uploadFitThumbnail !== "function") {
				return res.status(500).json({ error: "Fit thumbnail storage not available" });
			}
			const id = Number(req.params.id);
			if (!Number.isFinite(id) || id <= 0) {
				return res.status(400).json({ error: "Invalid creation id" });
			}
			const row = await queries.selectCreatedImageById.get(id, user.id);
			if (!row) {
				return res.status(404).json({ error: "Image not found" });
			}
			const storageFilename = resolveCreatedImageStorageFilename(row);
			if (!storageFilename) {
				return res.status(400).json({ error: "No storage filename for creation" });
			}
			const fullBuffer = await storage.getImageBuffer(storageFilename, {});
			const sharpMeta = await sharp(fullBuffer, { failOn: "none" }).metadata();
			const bw = Number(sharpMeta.width) || 0;
			const bh = Number(sharpMeta.height) || 0;
			if (bw > 0 && bh > 0 && !shouldGenerateFitThumbnail(bw, bh)) {
				return res.json({ ok: true, skipped: true, reason: "square", id });
			}
			await storage.uploadFitThumbnail(fullBuffer, storageFilename);
			return res.json({ ok: true, id, filename: storageFilename });
		} catch (error) {
			console.error("fit-thumbnail failed:", error);
			if (error?.message && String(error.message).includes("not found")) {
				return res.status(404).json({ error: "Image media not found" });
			}
			return res.status(500).json({ error: "Failed to generate fit thumbnail" });
		}
	});

	// POST /api/create/images/group - Group multiple unpublished image creations into one creation.
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
			const firstMeta = parseMeta(first.meta) || {};
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

	// GET /api/party/groups - List in-progress party group creations for the signed-in user.
	router.get("/api/party/groups", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
			const enableNsfw = Boolean(user.meta && user.meta.enableNsfw === true);
			const images = await queries.selectCreatedImagesForUser.all(user.id, {
				limit: 200,
				offset: 0,
				viewerEnableNsfw: enableNsfw
			});
			const parties = [];
			for (const img of Array.isArray(images) ? images : []) {
				const meta = parseMeta(img.meta) || {};
				if (meta?.party?.mode !== true || meta?.group?.kind !== "group_creations") continue;
				const queue = Array.isArray(meta.party.queue) ? meta.party.queue : [];
				const pushed = Array.isArray(meta.party.pushed) ? meta.party.pushed : [];
				const sourceIds = Array.isArray(meta.group?.source_creation_ids)
					? meta.group.source_creation_ids
					: [];
				const name =
					(typeof meta.party?.name === "string" && meta.party.name.trim()) ||
					(typeof meta.party?.settings?.partyName === "string" && meta.party.settings.partyName.trim()) ||
					(typeof img.title === "string" && img.title.trim()) ||
					"Party Mode";
				const status = img.status || "completed";
				const rawUrl =
					status === "completed"
						? img.file_path || storage.getImageUrl(img.filename)
						: null;
				const url = rawUrl ? appendCreationIdToMediaUrl(rawUrl, Number(img.id)) : null;
				parties.push({
					id: Number(img.id),
					title: typeof img.title === "string" && img.title.trim() ? img.title.trim() : name,
					name,
					updated_at:
						(typeof meta.group?.updated_at === "string" && meta.group.updated_at) ||
						(typeof meta.group?.grouped_at === "string" && meta.group.grouped_at) ||
						img.created_at,
					photo_count: sourceIds.length,
					queue_count: queue.length,
					pushed_count: pushed.length,
					thumbnail_url: url ? getThumbnailUrl(url) : null
				});
				if (parties.length >= limit) break;
			}
			return res.json({ parties });
		} catch (error) {
			return res.status(500).json({ error: "Failed to list party groups" });
		}
	});

	// DELETE /api/party/groups/:id - Delete a party group and all grouped source creations.
	router.delete("/api/party/groups/:id", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const groupId = Number(req.params.id);
			if (!Number.isFinite(groupId) || groupId <= 0) {
				return res.status(400).json({ error: "Invalid party id" });
			}
			const groupRow = await queries.selectCreatedImageById.get(groupId, user.id);
			if (!groupRow) {
				return res.status(404).json({ error: "Party not found" });
			}
			const meta = parseMeta(groupRow.meta) || {};
			if (meta?.party?.mode !== true || meta?.group?.kind !== "group_creations") {
				return res.status(400).json({ error: "Not a party group" });
			}

			const idsToDelete = collectPartyGroupDeletionIds(meta, groupId);
			const sourceIds = idsToDelete.filter((id) => id !== groupId);
			const deleted = [];

			for (const id of sourceIds) {
				const result = await deleteOwnedCreationForParty(user, id, queries);
				if (!result.ok) {
					return res.status(400).json({ error: result.error || "Failed to delete party photos" });
				}
				if (result.deleted) deleted.push(result.deleted);
			}

			const groupResult = await deleteOwnedCreationForParty(user, groupId, queries);
			if (!groupResult.ok) {
				return res.status(400).json({ error: groupResult.error || "Failed to delete party group" });
			}
			if (groupResult.deleted) deleted.push(groupResult.deleted);

			return res.json({ ok: true, deleted_creation_ids: deleted });
		} catch (error) {
			return res.status(500).json({ error: "Failed to delete party" });
		}
	});

	// POST /api/create/images/:id/party-settings - Persist Party Mode settings, queue, and pushed state on a party group.
	router.post("/api/create/images/:id/party-settings", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const groupId = Number(req.params.id);
			if (!Number.isFinite(groupId) || groupId <= 0) {
				return res.status(400).json({ error: "Invalid creation id" });
			}
			const settingsProvided = req.body?.party_settings != null;
			const pushedProvided = req.body?.party_pushed != null;
			const queueProvided = req.body?.party_queue != null;
			if (!settingsProvided && !pushedProvided && !queueProvided) {
				return res.status(400).json({ error: "Nothing to update" });
			}
			const settings = settingsProvided ? parsePartySettingsPayload(req.body.party_settings) : null;
			if (settingsProvided && !settings) {
				return res.status(400).json({ error: "Invalid party settings" });
			}
			const pushedParsed = pushedProvided ? parsePartyPushedPayload(req.body.party_pushed) : null;
			if (pushedProvided && pushedParsed === null) {
				return res.status(400).json({ error: "Invalid party pushed list" });
			}
			const queueParsed = queueProvided ? parsePartyQueuePayload(req.body.party_queue) : null;
			if (queueProvided && queueParsed === null) {
				return res.status(400).json({ error: "Invalid party queue list" });
			}
			const row = await queries.selectCreatedImageById.get(groupId, user.id);
			if (!row) {
				return res.status(404).json({ error: "Creation not found" });
			}
			const meta = parseMeta(row.meta) || {};
			if (meta?.group?.kind !== "group_creations" || meta?.party?.mode !== true) {
				return res.status(400).json({ error: "Creation is not a party group" });
			}
			const existingSettings =
				meta?.party?.settings && typeof meta.party.settings === "object" ? meta.party.settings : null;
			const nextSettings = settings || existingSettings || {
				version: 1,
				partyName: "",
				prompt: "",
				autoReviewReady: false
			};
			const existingPushed = Array.isArray(meta?.party?.pushed) ? meta.party.pushed : [];
			const nextPushedRaw = pushedProvided ? pushedParsed : existingPushed;
			const nextPushed = filterPartyPushedToGroupSources(meta, nextPushedRaw);
			const existingQueue = Array.isArray(meta?.party?.queue) ? meta.party.queue : [];
			const nextQueueRaw = queueProvided ? queueParsed : existingQueue;
			const nextQueue = filterPartyQueueToGroupSources(meta, nextQueueRaw, nextPushed);
			const partyName = nextSettings.partyName || meta?.party?.name || row.title || "Party Mode";
			const nextMeta = {
				...meta,
				party: {
					...(meta.party && typeof meta.party === "object" ? meta.party : {}),
					mode: true,
					name: partyName,
					settings: {
						...nextSettings,
						partyName
					},
					queue: nextQueue,
					pushed: nextPushed
				}
			};
			const metaResult = await queries.updateCreatedImageMeta.run(groupId, user.id, nextMeta);
			if (!metaResult || metaResult.changes === 0) {
				return res.status(500).json({ error: "Failed to update party settings" });
			}
			if (settingsProvided) {
				await queries.updateCreatedImage.run(groupId, user.id, partyName, row.description ?? null, false);
			}
			return res.json({
				ok: true,
				title: partyName,
				meta: nextMeta
			});
		} catch (error) {
			return res.status(500).json({ error: "Failed to save party settings" });
		}
	});

	// POST /api/create/images/:id/party-remove-source - Drop a source from a party group (discard).
	router.post("/api/create/images/:id/party-remove-source", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const groupId = Number(req.params.id);
			const creationId = Number(req.body?.creation_id ?? req.body?.creationId);
			if (!Number.isFinite(groupId) || groupId <= 0) {
				return res.status(400).json({ error: "Invalid group id" });
			}
			if (!Number.isFinite(creationId) || creationId <= 0) {
				return res.status(400).json({ error: "Invalid creation id" });
			}
			if (groupId === creationId) {
				return res.status(400).json({ error: "Cannot remove the party group creation" });
			}

			const groupRow = await queries.selectCreatedImageById.get(groupId, user.id);
			if (!groupRow) {
				return res.status(404).json({ error: "Party group not found" });
			}
			const meta = parseMeta(groupRow.meta) || {};
			if (meta?.party?.mode !== true || meta?.group?.kind !== "group_creations") {
				return res.status(400).json({ error: "Creation is not a party group" });
			}

			const removedState = removeCreationFromPartyGroupMeta(meta, creationId);
			if (!removedState) {
				return res.status(400).json({ error: "Invalid creation id" });
			}

			let nextMeta = removedState.meta;
			const groupPayload = nextMeta.group && typeof nextMeta.group === "object" ? nextMeta.group : null;
			const remainingSources = Array.isArray(groupPayload?.source_creations)
				? groupPayload.source_creations.filter((item) => item && typeof item === "object")
				: [];
			const coverSourceId = Number(groupPayload?.cover_source_id);

			if (remainingSources.length > 0 && Number.isFinite(coverSourceId) && coverSourceId > 0) {
				const coverState = buildGroupCoverUpdateState({
					groupMeta: nextMeta,
					groupPayload,
					sourceCreations: remainingSources,
					coverSourceId,
					storage,
					fallbackGroupRow: groupRow
				});
				if (coverState) {
					const updateResult = await queries.updateCreatedImageGroupCover?.run(
						groupId,
						user.id,
						coverState.updatePayload
					);
					if (!updateResult || updateResult.changes === 0) {
						return res.status(500).json({ error: "Failed to update party group cover" });
					}
					nextMeta = coverState.meta;
				} else {
					const metaResult = await queries.updateCreatedImageMeta.run(groupId, user.id, nextMeta);
					if (!metaResult || metaResult.changes === 0) {
						return res.status(500).json({ error: "Failed to update party group" });
					}
				}
			} else {
				const metaResult = await queries.updateCreatedImageMeta.run(groupId, user.id, nextMeta);
				if (!metaResult || metaResult.changes === 0) {
					return res.status(500).json({ error: "Failed to update party group" });
				}
			}

			const sourceRow = await queries.selectCreatedImageById.get(creationId, user.id);
			if (sourceRow) {
				const markResult = await queries.markCreatedImageUnavailable?.run(creationId, user.id);
				if (!markResult || markResult.changes === 0) {
					return res.status(500).json({ error: "Failed to discard source creation" });
				}
				if (queries.deleteFeedItemByCreatedImageId?.run) {
					await queries.deleteFeedItemByCreatedImageId.run(creationId);
				}
			}

			const updatedGroup = await queries.selectCreatedImageById.get(groupId, user.id);
			const outMeta = parseMeta(updatedGroup?.meta) || nextMeta;
			return res.json({
				ok: true,
				removed_from_group: removedState.removedFromGroup,
				title: typeof updatedGroup?.title === "string" ? updatedGroup.title : groupRow.title,
				meta: outMeta
			});
		} catch (error) {
			return res.status(500).json({ error: "Failed to remove source from party group" });
		}
	});

	// POST /api/create/images/:id/group-cover - Set grouped creation cover source.
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

	// POST /api/create/images/:id/group-reorder - Move a grouped source one slot left.
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

	// POST /api/create/images/:id/ungroup - Restore grouped source creations and archive the group creation.
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

	// POST /api/create/images/:id/publish - Publish a creation.
	// Title is optional; published creations without one display as "Untitled".
	router.post("/api/create/images/:id/publish", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const { title, description, nsfw, doom_scroll_full_height: doomScrollFullHeight } = req.body;

			const titleValue =
				typeof title === "string" && title.trim() !== "" ? title.trim() : null;

			// Get the image to verify ownership or admin status
			const image = await queries.selectCreatedImageById.get(
				req.params.id,
				user.id
			);

			// If not found as owner, check if it exists and user is admin
			let anyImage = null;
			if (!image) {
				anyImage = await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);
				if (!anyImage) {
					return res.status(404).json({ error: "Image not found" });
				}
				// Only admins can publish images they don't own
				if (user.role !== 'admin') {
					return res.status(403).json({ error: "Forbidden: You can only publish your own creations" });
				}
			}

			const targetImage = image || anyImage;
			const isAdmin = user.role === 'admin';
			const isOwner = image && image.user_id === user.id;

			if (targetImage.status !== 'completed') {
				return res.status(400).json({ error: "Image must be completed before publishing" });
			}

			const publishMeta = parseMeta(targetImage.meta) || {};
			if (
				Array.isArray(publishMeta.challenge_submissions) &&
				publishMeta.challenge_submissions.length > 0
			) {
				// Challenge entries can only be published once every challenge they are
				// entered in has ended (voting closed). Active challenges still block.
				const publishSb = getSupabaseServiceClient();
				const challengeSummary = await summarizeChallengeSubmissionPhases({
					sb: publishSb,
					meta: publishMeta
				});
				if (challengeSummary.anyActive || !challengeSummary.allEnded) {
					return res.status(400).json({
						error: "This creation is entered in an active challenge and can be published once the challenge ends."
					});
				}
			}

			if (targetImage.published === 1 || targetImage.published === true) {
				return res.status(400).json({ error: "Image is already published" });
			}
			// Publish the image
			const publishResult = await queries.publishCreatedImage.run(
				req.params.id,
				user.id,
				titleValue,
				description ? description.trim() : null,
				isAdmin
			);

			if (publishResult.changes === 0) {
				return res.status(500).json({ error: "Failed to publish image" });
			}

			// Persist publish options in meta when provided
			if (typeof nsfw !== 'undefined' || typeof doomScrollFullHeight !== 'undefined') {
				const currentMeta = parseMeta(targetImage.meta) || {};
				const mergedMeta = { ...currentMeta };
				if (typeof nsfw !== 'undefined') {
					mergedMeta.nsfw = !!nsfw;
				}
				if (typeof doomScrollFullHeight !== 'undefined') {
					mergedMeta.doom_scroll_full_height = !!doomScrollFullHeight;
				}
				await queries.updateCreatedImageMeta.run(req.params.id, targetImage.user_id, mergedMeta);
			}

			// Keep feed attribution tied to the creation owner, not the publishing admin.
			let feedAuthor = user.email || 'User';
			if (targetImage.user_id) {
				try {
					const creator = await queries.selectUserById.get(targetImage.user_id);
					if (creator?.email) {
						feedAuthor = creator.email;
					}
				} catch {
					// Ignore profile lookup errors; use current fallback.
				}
			}

			// Create feed item.
			// feed_items.title is NOT NULL; map optional empty creation titles to "Untitled".
			await queries.insertFeedItem.run(
				titleValue || 'Untitled',
				description ? description.trim() : '',
				feedAuthor,
				null, // tags
				parseInt(req.params.id)
			);
			await bumpFeedVersionCounter();

			// Get updated image (includes meta with nsfw if we updated it)
			const updatedImage = isOwner
				? await queries.selectCreatedImageById.get(req.params.id, user.id)
				: await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);

			// Queue embedding job at publish (only time we create it).
			scheduleEmbeddingJob({ creation: updatedImage, queries }).catch((err) => {
				console.warn("[create] Failed to schedule embedding job:", err?.message || err);
			});

			const updatedMeta = parseMeta(updatedImage?.meta);

			void notifyCreationMentionsOnPublish({
				queries,
				creationId: updatedImage.id,
				publisherUserId: targetImage.user_id,
				title: titleValue,
				description: description ? description.trim() : null,
				meta: updatedMeta
			});

			return res.json({
				id: updatedImage.id,
				filename: updatedImage.filename,
				url: updatedImage.file_path || storage.getImageUrl(updatedImage.filename), // Use stored URL or generate one
				width: updatedImage.width,
				height: updatedImage.height,
				color: updatedImage.color,
				status: updatedImage.status || 'completed',
				created_at: updatedImage.created_at,
				published: true,
				published_at: updatedImage.published_at,
				title: updatedImage.title,
				description: updatedImage.description,
				meta: updatedMeta,
				nsfw: !!updatedMeta?.nsfw
			});
		} catch (error) {
			// console.error("Error publishing image:", error);
			return res.status(500).json({ error: "Failed to publish image" });
		}
	});

	// PUT /api/create/images/:id - Update a creation's title/description.
	// Title is optional; published creations without one display as "Untitled".
	router.put("/api/create/images/:id", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const { title, description, nsfw, doom_scroll_full_height: doomScrollFullHeight } = req.body;

			// Get the image to verify ownership or admin status
			const image = await queries.selectCreatedImageById.get(
				req.params.id,
				user.id
			);

			// If not found as owner, check if it exists and user is admin
			let anyImage = null;
			if (!image) {
				anyImage = await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);
				if (!anyImage) {
					return res.status(404).json({ error: "Image not found" });
				}
				// Only admins can edit images they don't own
				if (user.role !== 'admin') {
					return res.status(403).json({ error: "Forbidden: You can only edit your own creations" });
				}
			}

			const targetImage = image || anyImage;
			const isAdmin = user.role === 'admin';
			const isOwner = image && image.user_id === user.id;
			const titleValue =
				typeof title === "string"
					? (title.trim() || null)
					: (targetImage.title != null && String(targetImage.title).trim()
						? String(targetImage.title).trim()
						: null);

			// Update the image
			const updateResult = await queries.updateCreatedImage.run(
				req.params.id,
				user.id,
				titleValue,
				description ? description.trim() : null,
				isAdmin
			);

			if (updateResult.changes === 0) {
				return res.status(500).json({ error: "Failed to update image" });
			}

			// Persist edit options in meta when provided
			if (typeof nsfw !== 'undefined' || typeof doomScrollFullHeight !== 'undefined') {
				const currentMeta = parseMeta(targetImage.meta) || {};
				const mergedMeta = { ...currentMeta };
				if (typeof nsfw !== 'undefined') {
					mergedMeta.nsfw = !!nsfw;
				}
				if (typeof doomScrollFullHeight !== 'undefined') {
					mergedMeta.doom_scroll_full_height = !!doomScrollFullHeight;
				}
				await queries.updateCreatedImageMeta.run(req.params.id, targetImage.user_id, mergedMeta);
			}

			// Update the associated feed item if it exists.
			// feed_items.title is NOT NULL; map optional empty creation titles to "Untitled".
			const feedItem = await queries.selectFeedItemByCreatedImageId?.get(parseInt(req.params.id));
			if (feedItem) {
				await queries.updateFeedItem?.run(
					parseInt(req.params.id),
					titleValue || 'Untitled',
					description ? description.trim() : ''
				);
			}

			// Get updated image
			const updatedImage = isOwner
				? await queries.selectCreatedImageById.get(req.params.id, user.id)
				: await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);

			// If published, queue embedding refresh so semantic uses updated title/description.
			if (updatedImage && (updatedImage.published === 1 || updatedImage.published === true)) {
				scheduleEmbeddingJob({ creation: updatedImage, queries }).catch((err) => {
					console.warn("[create] Failed to schedule embedding job:", err?.message || err);
				});
			}

			const updatedMeta = parseMeta(updatedImage?.meta);
			return res.json({
				id: updatedImage.id,
				filename: updatedImage.filename,
				url: updatedImage.file_path || storage.getImageUrl(updatedImage.filename),
				width: updatedImage.width,
				height: updatedImage.height,
				color: updatedImage.color,
				status: updatedImage.status || 'completed',
				created_at: updatedImage.created_at,
				published: updatedImage.published === 1 || updatedImage.published === true,
				published_at: updatedImage.published_at,
				title: updatedImage.title,
				description: updatedImage.description,
				meta: updatedMeta,
				nsfw: !!updatedMeta?.nsfw
			});
		} catch (error) {
			// console.error("Error updating image:", error);
			return res.status(500).json({ error: "Failed to update image" });
		}
	});

	// POST /api/create/images/:id/unpublish - Un-publish a creation
	router.post("/api/create/images/:id/unpublish", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			// Get the image to verify ownership or admin status
			const image = await queries.selectCreatedImageById.get(
				req.params.id,
				user.id
			);

			// If not found as owner, check if it exists and user is admin
			let anyImage = null;
			if (!image) {
				anyImage = await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);
				if (!anyImage) {
					return res.status(404).json({ error: "Image not found" });
				}
				// Only admins can unpublish images they don't own
				if (user.role !== 'admin') {
					return res.status(403).json({ error: "Forbidden: You can only unpublish your own creations" });
				}
			}

			const targetImage = image || anyImage;
			const isPublished = targetImage.published === 1 || targetImage.published === true;

			if (!isPublished) {
				return res.status(400).json({ error: "Image is not published" });
			}

			const isAdmin = user.role === 'admin';
			const isOwner = image && image.user_id === user.id;

			// Un-publish the image
			const unpublishResult = await queries.unpublishCreatedImage.run(
				req.params.id,
				user.id,
				isAdmin
			);

			if (unpublishResult.changes === 0) {
				return res.status(500).json({ error: "Failed to unpublish image" });
			}

			// Delete the associated feed item if it exists
			if (queries.deleteFeedItemByCreatedImageId) {
				await queries.deleteFeedItemByCreatedImageId.run(parseInt(req.params.id));
			}
			await bumpFeedVersionCounter();

			// Delete all likes for this created image
			if (queries.deleteAllLikesForCreatedImage) {
				await queries.deleteAllLikesForCreatedImage.run(parseInt(req.params.id));
			}

			// Delete all comments for this created image
			if (queries.deleteAllCommentsForCreatedImage) {
				await queries.deleteAllCommentsForCreatedImage.run(parseInt(req.params.id));
			}

			// Remove embedding so unpublished item drops out of semantic search / related
			const supabase = getSupabaseServiceClient();
			if (supabase) {
				try {
					await deleteCreationEmbedding(supabase, parseInt(req.params.id));
				} catch (err) {
					console.warn("[create] Failed to delete embedding on unpublish:", err?.message || err);
				}
			}

			// Get updated image
			const updatedImage = isOwner
				? await queries.selectCreatedImageById.get(req.params.id, user.id)
				: await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);

			return res.json({
				id: updatedImage.id,
				filename: updatedImage.filename,
				url: updatedImage.file_path || storage.getImageUrl(updatedImage.filename),
				width: updatedImage.width,
				height: updatedImage.height,
				color: updatedImage.color,
				status: updatedImage.status || 'completed',
				created_at: updatedImage.created_at,
				published: false,
				published_at: null,
				title: updatedImage.title,
				description: updatedImage.description
			});
		} catch (error) {
			// console.error("Error unpublishing image:", error);
			return res.status(500).json({ error: "Failed to unpublish image" });
		}
	});

	// POST /api/create/images/:id/admin-add-video - Admin only: add or replace video (including repair on failed/incomplete rows).
	router.post("/api/create/images/:id/admin-add-video", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		if (user.role !== "admin") {
			return res.status(403).json({ error: "Forbidden: Admin role required" });
		}

		const id = Number(req.params.id);
		if (!Number.isFinite(id) || id <= 0) {
			return res.status(400).json({ error: "Invalid creation id" });
		}

		const image = await queries.selectCreatedImageByIdAnyUser?.get(id);
		if (!image) {
			return res.status(404).json({ error: "Creation not found" });
		}

		if (typeof storage.uploadVideo !== "function") {
			return res.status(503).json({ error: "Video upload not available" });
		}

		if (!req.is("multipart/form-data")) {
			return res.status(400).json({ error: "Request must be multipart/form-data with a video file" });
		}

		try {
			const maxVideoBytes = 200 * 1024 * 1024; // 200MB
			const { files } = await parseMultipartCreate(req, { maxFileBytes: maxVideoBytes });
			const videoFile = files?.video;
			if (!videoFile || !Buffer.isBuffer(videoFile.buffer) || videoFile.buffer.length === 0) {
				return res.status(400).json({ error: "No video file provided; use form field name 'video'" });
			}
			const mimeType = typeof videoFile.mimeType === "string" ? videoFile.mimeType.trim() : "";
			if (!mimeType.startsWith("video/")) {
				return res.status(400).json({ error: "File must be a video (e.g. video/mp4)" });
			}

			const baseExt = mimeType.split("/")[1]?.split("+")[0]?.split(";")[0]?.trim() || "mp4";
			const safeExt = (baseExt && /^[a-z0-9]+$/i.test(baseExt)) ? baseExt : "mp4";
			const timestamp = Date.now();
			const random = Math.random().toString(36).substring(2, 9);
			const videoFilename = `video/${image.user_id}_${id}_${timestamp}_${random}.${safeExt}`;

			const videoUrl = await storage.uploadVideo(videoFile.buffer, videoFilename, {
				contentType: mimeType || "video/mp4"
			});

			const existingMeta = parseMeta(image.meta) || {};
			const imageStatus = image.status || "completed";
			const isRepair = imageStatus !== "completed";
			const argsObj = existingMeta.args && typeof existingMeta.args === "object" ? existingMeta.args : {};
			const sourceFromArgs =
				(typeof argsObj.image_url === "string" && argsObj.image_url) ||
				(typeof argsObj.image === "string" && argsObj.image) ||
				(Array.isArray(argsObj.input_images) && typeof argsObj.input_images[0] === "string" && argsObj.input_images[0]) ||
				null;
			const mergedMeta = {
				...existingMeta,
				media_type: "video",
				...(isRepair
					? {
						completed_at: existingMeta.completed_at || new Date().toISOString(),
						provider_status: "succeeded",
						admin_video_repaired_at: new Date().toISOString(),
					}
					: {}),
				...(!existingMeta.source_image_url && sourceFromArgs
					? { source_image_url: String(sourceFromArgs).trim() }
					: {}),
				video: {
					filename: videoFilename,
					file_path: videoUrl,
					content_type: mimeType || "video/mp4"
				}
			};

			const hasThumbnail = image.file_path && String(image.file_path).trim() !== "";
			if (!hasThumbnail && typeof storage.uploadImage === "function") {
				let thumbBuffer;
				try {
					thumbBuffer = sourceFromArgs
						? await fetchImageBufferFromUrl(String(sourceFromArgs).trim())
						: await createPlaceholderImageBuffer();
				} catch {
					thumbBuffer = await createPlaceholderImageBuffer();
				}
				const thumbFilename = `${image.user_id}_${id}_${timestamp}_${random}.png`;
				const thumbUrl = await storage.uploadImage(thumbBuffer, thumbFilename);
				let width = image.width ?? null;
				let height = image.height ?? null;
				try {
					const metaSharp = await sharp(thumbBuffer, { failOn: "none" }).metadata();
					if (typeof metaSharp.width === "number" && metaSharp.width > 0) width = metaSharp.width;
					if (typeof metaSharp.height === "number" && metaSharp.height > 0) height = metaSharp.height;
				} catch {
					// keep existing or null
				}
				const completedResult = await queries.updateCreatedImageJobCompleted.run(id, image.user_id, {
					filename: thumbFilename,
					file_path: thumbUrl,
					width,
					height,
					color: image.color ?? null,
					meta: mergedMeta
				});
				if (completedResult.changes === 0) {
					return res.status(500).json({ error: "Failed to update creation with thumbnail" });
				}
			} else {
				const updateResult = await queries.updateCreatedImageMeta.run(id, image.user_id, mergedMeta);
				if (updateResult.changes === 0) {
					return res.status(500).json({ error: "Failed to update creation meta" });
				}
			}

			if (isRepair && typeof queries.updateCreatedImageStatus?.run === "function") {
				await queries.updateCreatedImageStatus.run(id, image.user_id, "completed");
			}

			return res.json({
				ok: true,
				video_url: videoUrl,
				repaired: isRepair
			});
		} catch (err) {
			// console.error("Error adding admin video:", err);
			const message = err?.message && typeof err.message === "string" ? err.message : "Failed to add video";
			return res.status(500).json({ error: "Failed to add video", message });
		}
	});

	// POST /api/create/images/:id/video-placeholder — Owner/admin: set poster image for t2v rows with a broken placeholder.
	router.post("/api/create/images/:id/video-placeholder", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const id = Number(req.params.id);
		if (!Number.isFinite(id) || id <= 0) {
			return res.status(400).json({ error: "Invalid creation id" });
		}

		let image = await queries.selectCreatedImageById?.get(id, user.id);
		if (!image) {
			image = await queries.selectCreatedImageByIdAnyUser?.get(id);
			if (!image) {
				return res.status(404).json({ error: "Creation not found" });
			}
			const isOwner = image.user_id === user.id;
			if (!isOwner && user.role !== "admin") {
				return res.status(403).json({ error: "Forbidden" });
			}
		}

		if ((image.status || "") !== "completed") {
			return res.status(400).json({ error: "Only completed creations can have a poster set" });
		}

		const existingMeta = parseMeta(image.meta) || {};
		const creationForCheck = {
			status: image.status,
			width: image.width,
			height: image.height,
			meta: existingMeta,
			video_url: typeof existingMeta?.video?.file_path === "string" ? existingMeta.video.file_path : null,
			media_type: existingMeta.media_type,
		};
		if (!canSetVideoPosterFromFirstFrame(creationForCheck)) {
			return res.status(400).json({ error: "This creation cannot have its poster set from video" });
		}

		if (!req.is("multipart/form-data")) {
			return res.status(400).json({ error: "Request must be multipart/form-data with an image file" });
		}

		try {
			const maxBytes = 20 * 1024 * 1024;
			const { fields, files } = await parseMultipartCreate(req, { maxFileBytes: maxBytes });
			const imageFile = files?.image;
			if (!imageFile || !Buffer.isBuffer(imageFile.buffer) || imageFile.buffer.length === 0) {
				return res.status(400).json({ error: "No image file provided; use form field name 'image'" });
			}
			const mimeType = typeof imageFile.mimeType === "string" ? imageFile.mimeType.trim() : "";
			if (!mimeType.startsWith("image/")) {
				return res.status(400).json({ error: "File must be an image" });
			}

			const targetWidth = Number(fields?.video_width);
			const targetHeight = Number(fields?.video_height);
			const hasTargetDims =
				Number.isFinite(targetWidth) &&
				targetWidth > 0 &&
				Number.isFinite(targetHeight) &&
				targetHeight > 0;

			let pngBuffer = await ensurePngBuffer(imageFile.buffer);
			const sharpMeta = await sharp(pngBuffer).metadata();
			let width = Number(sharpMeta.width);
			let height = Number(sharpMeta.height);
			if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
				return res.status(400).json({ error: "Could not read image dimensions" });
			}

			if (hasTargetDims && (width !== targetWidth || height !== targetHeight)) {
				pngBuffer = await sharp(pngBuffer)
					.resize(Math.round(targetWidth), Math.round(targetHeight), { fit: "fill" })
					.png()
					.toBuffer();
				width = Math.round(targetWidth);
				height = Math.round(targetHeight);
			}

			const timestamp = Date.now();
			const random = Math.random().toString(36).substring(2, 9);
			const filename = `${image.user_id}_${id}_${timestamp}_${random}.png`;
			const imageUrl = await storage.uploadImage(pngBuffer, filename);

			const mergedMeta = {
				...existingMeta,
				video_placeholder_manual: true,
			};

			const updateResult = await queries.updateCreatedImageJobCompleted.run(id, image.user_id, {
				filename,
				file_path: imageUrl,
				width,
				height,
				color: image.color ?? null,
				meta: mergedMeta,
			});
			if (updateResult.changes === 0) {
				return res.status(500).json({ error: "Failed to update creation poster" });
			}

			await bumpFeedVersionCounter();
			void invalidateFeedBetaCatalogSnapshot().catch(() => { });

			return res.json({
				ok: true,
				url: imageUrl,
				width,
				height,
			});
		} catch (err) {
			const message = err?.message && typeof err.message === "string" ? err.message : "Failed to set poster";
			return res.status(500).json({ error: "Failed to set poster", message });
		}
	});

	// POST /api/create/images/:id/adjust — Signed-in user: save client-side brightness/contrast/saturation
	// as a new completed creation owned by the caller (source may be own or published).
	router.post("/api/create/images/:id/adjust", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const id = Number(req.params.id);
		if (!Number.isFinite(id) || id <= 0) {
			return res.status(400).json({ error: "Invalid creation id" });
		}

		const image = await queries.selectCreatedImageByIdAnyUser?.get(id);
		if (!image) {
			return res.status(404).json({ error: "Creation not found" });
		}
		const isOwner = Number(image.user_id) === Number(user.id);
		const isAdmin = user.role === "admin";
		const isPublished = image.published === 1 || image.published === true;
		if (!isOwner && !isAdmin && !isPublished) {
			return res.status(403).json({ error: "Forbidden" });
		}

		if ((image.status || "") !== "completed") {
			return res.status(400).json({ error: "Only completed creations can be adjusted" });
		}

		const existingMeta = parseMeta(image.meta) || {};
		if (existingMeta?.group?.kind === "group_creations") {
			return res.status(400).json({ error: "Adjust is not available for grouped creations" });
		}
		if (existingMeta.media_type === "video" || existingMeta?.video?.file_path) {
			return res.status(400).json({ error: "Adjust is only available for image creations" });
		}

		if (!req.is("multipart/form-data")) {
			return res.status(400).json({ error: "Request must be multipart/form-data with an image file" });
		}

		try {
			const maxBytes = 20 * 1024 * 1024;
			const { fields, files } = await parseMultipartCreate(req, { maxFileBytes: maxBytes });
			const imageFile = files?.image;
			if (!imageFile || !Buffer.isBuffer(imageFile.buffer) || imageFile.buffer.length === 0) {
				return res.status(400).json({ error: "No image file provided; use form field name 'image'" });
			}
			const mimeType = typeof imageFile.mimeType === "string" ? imageFile.mimeType.trim() : "";
			if (!mimeType.startsWith("image/")) {
				return res.status(400).json({ error: "File must be an image" });
			}

			const clampAdj = (raw) => {
				const n = Number(raw);
				if (!Number.isFinite(n)) return 100;
				return Math.max(0, Math.min(200, Math.round(n)));
			};
			const brightness = clampAdj(fields?.brightness);
			const contrast = clampAdj(fields?.contrast);
			const saturation = clampAdj(fields?.saturation);
			if (brightness === 100 && contrast === 100 && saturation === 100) {
				return res.status(400).json({ error: "No adjustments to save" });
			}

			const pngBuffer = await ensurePngBuffer(imageFile.buffer);
			const sharpMeta = await sharp(pngBuffer).metadata();
			const width = Number(sharpMeta.width);
			const height = Number(sharpMeta.height);
			if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
				return res.status(400).json({ error: "Could not read image dimensions" });
			}

			const timestamp = Date.now();
			const random = Math.random().toString(36).substring(2, 9);
			const filename = `${user.id}_${timestamp}_${random}.png`;
			const imageUrl = await storage.uploadImage(pngBuffer, filename);

			const sourceTitle = typeof image.title === "string" ? image.title.trim() : "";
			const sourceDescription = typeof image.description === "string" ? image.description.trim() : "";
			const lineage = buildMutateLineageMetaFields(existingMeta, id);
			if (!lineage) {
				return res.status(400).json({ error: "Invalid source creation for adjust" });
			}
			const nextMeta = {
				media_type: "image",
				method: "adjust",
				method_name: "Adjust",
				args: {
					brightness,
					contrast,
					saturation,
				},
				...lineage,
			};

			const insertResult = await queries.insertCreatedImage.run(
				user.id,
				filename,
				imageUrl,
				width,
				height,
				image.color ?? null,
				"completed",
				nextMeta
			);
			const newId = Number(insertResult?.insertId);
			if (!Number.isFinite(newId) || newId <= 0) {
				return res.status(500).json({ error: "Failed to create adjusted image" });
			}

			if (sourceTitle || sourceDescription) {
				await queries.updateCreatedImage?.run(
					newId,
					user.id,
					sourceTitle || null,
					sourceDescription || null,
					false
				);
			}

			await bumpFeedVersionCounter();
			void invalidateFeedBetaCatalogSnapshot().catch(() => { });

			return res.json({
				ok: true,
				id: newId,
				url: imageUrl,
				width,
				height,
			});
		} catch (err) {
			const message = err?.message && typeof err.message === "string" ? err.message : "Failed to save adjusted image";
			return res.status(500).json({ error: "Failed to save adjusted image", message });
		}
	});

	// POST /api/create/images/:id/share-audio — Store shareable audio extracted client-side from a video creation.
	router.post(
		"/api/create/images/:id/share-audio",
		express.raw({ type: () => true, limit: `${SHARE_AUDIO_MAX_BYTES}b` }),
		async (req, res) => {
			const user = await requireUser(req, res);
			if (!user) return;

			const id = Number(req.params.id);
			if (!Number.isFinite(id) || id <= 0) {
				return res.status(400).json({ error: "Invalid creation id" });
			}

			const image = await queries.selectCreatedImageByIdAnyUser?.get(id);
			if (!image) {
				return res.status(404).json({ error: "Creation not found" });
			}

			const isOwner = Number(image.user_id) === Number(user.id);
			const isAdmin = user.role === "admin";
			const isPublished = image.published === 1 || image.published === true;
			if (!isOwner && !isAdmin && !isPublished) {
				return res.status(403).json({ error: "Forbidden" });
			}

			if ((image.status || "") !== "completed") {
				return res.status(400).json({ error: "Only completed creations support share audio" });
			}

			const existingMeta = parseMeta(image.meta) || {};
			if (existingMeta?.group?.kind === "group_creations") {
				return res.status(400).json({ error: "Share audio is not available for grouped creations" });
			}
			if (existingMeta.media_type !== "video" || !existingMeta?.video?.file_path) {
				return res.status(400).json({ error: "Share audio is only available for video creations" });
			}

			const libraryAudioClipId = await resolveClipIdFromOutputMeta(queries, existingMeta);
			if (libraryAudioClipId) {
				return res.status(400).json({ error: "Share audio is not available for creations that use a library audio clip" });
			}

			const existingShareAudio =
				existingMeta.share_audio && typeof existingMeta.share_audio === "object"
					? existingMeta.share_audio
					: null;
			const existingKey =
				typeof existingShareAudio?.key === "string" ? existingShareAudio.key.trim() : "";
			const existingPath =
				typeof existingShareAudio?.file_path === "string" ? existingShareAudio.file_path.trim() : "";
			if (existingKey || existingPath) {
				void ensureAudioClipLibraryRowFromShareAudio({
					queries,
					storageKey: existingKey,
					mimeType: existingShareAudio?.content_type,
					byteSize: 0,
					extractorUserId: user.id,
					sourceCreation: image,
					durationSec: existingShareAudio?.duration_sec,
				});
				return res.json({
					ok: true,
					audio_url: existingPath || buildGenericUrl(existingKey),
					share_audio: existingShareAudio,
					already_exists: true,
				});
			}

			if (typeof storage.uploadGenericImage !== "function") {
				return res.status(503).json({ error: "Audio storage not available" });
			}

			try {
				const audioBuffer = req.body;
				if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
					return res.status(400).json({ error: "Empty audio upload" });
				}
				if (audioBuffer.length > SHARE_AUDIO_MAX_BYTES) {
					return res.status(413).json({
						error: "Audio file too large",
						message: "Extracted audio must be 20 MB or smaller.",
						max_bytes: SHARE_AUDIO_MAX_BYTES,
					});
				}

				const mimeType = normalizeShareAudioContentType(req.headers["content-type"]);
				const durationHeader = req.headers["x-share-audio-duration-sec"];
				const durationNum = durationHeader != null ? Number(durationHeader) : null;
				const durationSec =
					Number.isFinite(durationNum) && durationNum > 0 ? durationNum : null;
				const safeExt = shareAudioExtFromContentType(mimeType);
				const timestamp = Date.now();
				const random = Math.random().toString(36).substring(2, 9);
				const storageKey = `share-audio/${image.user_id}_${id}_${timestamp}_${random}.${safeExt}`;

				await storage.uploadGenericImage(audioBuffer, storageKey, {
					contentType: mimeType,
				});
				const audioUrl = buildGenericUrl(storageKey);

				const shareAudio = {
					key: storageKey,
					file_path: audioUrl,
					content_type: mimeType,
					extracted_at: new Date().toISOString(),
					...(durationSec != null ? { duration_sec: durationSec } : {}),
				};
				const mergedMeta = {
					...existingMeta,
					share_audio: shareAudio,
				};

				const updateResult = await queries.updateCreatedImageMeta.run(id, image.user_id, mergedMeta);
				if (updateResult.changes === 0) {
					return res.status(500).json({ error: "Failed to save audio reference on creation" });
				}

				void ensureAudioClipLibraryRowFromShareAudio({
					queries,
					storageKey,
					mimeType,
					byteSize: audioBuffer.length,
					extractorUserId: user.id,
					sourceCreation: image,
					durationSec,
				});

				return res.json({
					ok: true,
					audio_url: audioUrl,
					share_audio: shareAudio,
				});
			} catch (err) {
				const raw = err?.message && typeof err.message === "string" ? err.message : "Failed to save audio";
				const message = raw.replace(/^Failed to upload generic image:\s*/i, "");
				return res.status(500).json({ error: "Failed to save audio", message });
			}
		}
	);

	// POST /api/create/images/:id/admin-restore-user-delete — Admin only: undo owner soft-delete (clear unavailable_at).
	router.post("/api/create/images/:id/admin-restore-user-delete", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		if (user.role !== "admin") {
			return res.status(403).json({ error: "Forbidden: Admin role required" });
		}

		const id = Number(req.params.id);
		if (!Number.isFinite(id) || id <= 0) {
			return res.status(400).json({ error: "Invalid creation id" });
		}

		if (!queries.selectCreatedImageByIdAnyUser?.get || !queries.unmarkCreatedImageUnavailable?.run) {
			return res.status(503).json({ error: "Restore not available" });
		}

		try {
			const image = await queries.selectCreatedImageByIdAnyUser.get(id);
			if (!image) {
				return res.status(404).json({ error: "Creation not found" });
			}

			const wasUserDeleted =
				image.unavailable_at != null && String(image.unavailable_at).trim() !== "";
			if (!wasUserDeleted) {
				return res.status(400).json({ error: "Creation is not user-deleted" });
			}

			const ownerId = image.user_id;
			const unmarkResult = await queries.unmarkCreatedImageUnavailable.run(id, ownerId);
			if (!unmarkResult || unmarkResult.changes === 0) {
				return res.status(500).json({ error: "Failed to restore creation" });
			}

			const isPublished = image.published === 1 || image.published === true;
			if (isPublished && queries.insertFeedItem?.run) {
				let existingFeed = null;
				try {
					existingFeed = await queries.selectFeedItemByCreatedImageId?.get?.(id);
				} catch {
					existingFeed = null;
				}
				if (!existingFeed) {
					let feedAuthor = "User";
					if (ownerId) {
						try {
							const creator = await queries.selectUserById.get(ownerId);
							if (creator?.email) {
								feedAuthor = creator.email;
							}
						} catch {
							// ignore
						}
					}
					const title = String(image.title || "").trim() || "Untitled";
					const description = image.description ? String(image.description).trim() : "";
					await queries.insertFeedItem.run(title, description, feedAuthor, null, id);
					await bumpFeedVersionCounter();
				}
			}

			const updatedImage = await queries.selectCreatedImageByIdAnyUser.get(id);
			if (updatedImage && (updatedImage.published === 1 || updatedImage.published === true)) {
				scheduleEmbeddingJob({ creation: updatedImage, queries }).catch((err) => {
					console.warn("[create] Failed to schedule embedding job:", err?.message || err);
				});
			}

			return res.json({ ok: true, restored: true });
		} catch (error) {
			return res.status(500).json({
				error: "Failed to restore creation",
				message: error?.message || String(error)
			});
		}
	});

	// DELETE /api/create/images/:id/landscape - Remove landscape from a creation. Owner only.
	router.delete("/api/create/images/:id/landscape", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const creationId = Number(req.params.id);
		if (!Number.isFinite(creationId) || creationId <= 0) {
			return res.status(400).json({ error: "Invalid creation id" });
		}

		const image = await queries.selectCreatedImageById.get(creationId, user.id);
		if (!image) {
			return res.status(404).json({ error: "Creation not found" });
		}

		const meta = parseMeta(image.meta) || {};
		const landscapeFilename = meta.landscapeFilename;
		const hadLandscape = landscapeFilename || (meta.landscapeUrl && meta.landscapeUrl !== "loading" && !String(meta.landscapeUrl).startsWith("error:"));

		if (landscapeFilename && storage?.deleteImage) {
			try {
				await storage.deleteImage(landscapeFilename);
			} catch (storageError) {
				// Log but don't fail the request
			}
		}

		const nextMeta = { ...meta };
		delete nextMeta.landscapeUrl;
		delete nextMeta.landscapeFilename;
		delete nextMeta.credits_refunded;
		await queries.updateCreatedImageMeta.run(creationId, user.id, nextMeta);

		return res.json({
			ok: true,
			removed: !!hadLandscape
		});
	});

	// DELETE /api/create/images/:id - Delete a creation (owner: mark unavailable; admin with ?permanent=1: remove permanently)
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
				return res.json({ success: true, message: "Image permanently deleted" });
			}

			// Owner (or admin without permanent): mark unavailable so it no longer shows anywhere except admin
			const image = await queries.selectCreatedImageById.get(req.params.id, user.id);
			if (!image) {
				return res.status(404).json({ error: "Image not found" });
			}
			const meta = parseMeta(image.meta);
			const status = image.status || "completed";
			if (status === "creating") {
				const timeoutAt = meta?.timeout_at ? new Date(meta.timeout_at).getTime() : NaN;
				if (!Number.isFinite(timeoutAt) || Date.now() <= timeoutAt) {
					return res.status(400).json({ error: "Cannot delete an in-progress creation" });
				}
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

	return router;
}
