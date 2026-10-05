import express from "express";
import { getSupabaseServiceClient } from "../services/create/supabaseService.js";
import { isGroupV2Meta } from "../services/create/projectGroupV2.js";
import { broadcastRoomDirty, broadcastUserInboxDirty } from "../services/challenges/realtimeBroadcast.js";
import { repairLastReadPointersForDeletedMessages } from "../services/challenges/chatInviteCleanup.js";
import { insertNotificationsForChatMentions } from "../services/challenges/chatMentionNotifications.js";
import { fetchChatChannelThreadRow, findChallengesChannelThreadId, validateChallengeSubmission, listChallengeConfigsAcceptingSubmissions, summarizeAcceptingChallengesForEligibility, filterAcceptingChallengesByMedia, fetchThreadMessagesChronological, metaHasChallengeSubmission, isChatThreadMember, summarizeChallengeSubmissionPhases } from "../services/create/challengeSubmitShared.js";
import {
	creationMediaTypeFromMeta
} from "../client/shared/challenges/model/tracks.js";
import { getCreationFeedPinStatus } from "../services/feed/editorialPin.js";
import { creationMetaHasActiveChallengeFeedPin } from "../client/shared/challengeSubmitMeta.js";
import { creationMetaHasChallengeOrganizerRef } from "../client/shared/challengeOrganizerRefMeta.js";

export default function createChallengeCreationRoutes({ queries, storage }) {
const router = express.Router();

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
		if (group || isGroupV2Meta(meta)) {
			response.challenge_submit = { eligible: false, reason: "group" };
			return;
		}

		try {
			const pinStatus = await getCreationFeedPinStatus(queries, image.id);
			if (pinStatus.active) {
				response.challenge_submit = { eligible: false, reason: "feed_pin" };
				return;
			}
		} catch {
			// ignore — fall through to normal eligibility
		}
		if (creationMetaHasActiveChallengeFeedPin(meta)) {
			response.challenge_submit = { eligible: false, reason: "feed_pin" };
			return;
		}
		if (creationMetaHasChallengeOrganizerRef(meta)) {
			response.challenge_submit = { eligible: false, reason: "organizer_ref" };
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

		try {
			const memberOk = await isChatThreadMember(sb, threadId, user.id);
			if (!memberOk) {
				response.challenge_submit = {
					eligible: false,
					reason: "blocked",
					message: "Join the Challenges channel before submitting."
				};
				return;
			}

			const messages = await fetchThreadMessagesChronological(sb, threadId);
			const messagesNewest = [...messages].reverse();
			const acceptingAll = listChallengeConfigsAcceptingSubmissions(messagesNewest);
			const mediaType = creationMediaTypeFromMeta(meta);
			const accepting = filterAcceptingChallengesByMedia(acceptingAll, mediaType);
			const challenges = summarizeAcceptingChallengesForEligibility(accepting).filter((ch) => {
				return !metaHasChallengeSubmission(meta, threadId, ch.challenge_id);
			});
			if (!challenges.length) {
				response.challenge_submit = {
					eligible: false,
					reason: "blocked",
					message:
						accepting.length > 0
							? "This creation is already entered in every open challenge that accepts this media."
							: acceptingAll.length > 0
								? "No open challenge accepts this creation's media type."
								: "No challenge is accepting submissions right now."
				};
				return;
			}

			const primary = challenges[0];
			response.challenge_submit = {
				eligible: true,
				reason: null,
				thread_id: threadId,
				challenge_id: primary.challenge_id,
				challenges,
				challenge: {
					challenge_id: primary.challenge_id,
					title: primary.title,
					details: primary.details
				}
			};
		} catch (err) {
			console.warn("[challenge_submit eligibility]", err?.message || err);
			response.challenge_submit = {
				eligible: false,
				reason: "blocked",
				message: "Could not check challenge eligibility."
			};
		}
	}

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
		const requestedChallengeId =
			req.body?.challenge_id != null
				? String(req.body.challenge_id).trim()
				: req.body?.challengeId != null
					? String(req.body.challengeId).trim()
					: "";

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

			try {
				const pinStatus = await getCreationFeedPinStatus(queries, imageId);
				if (pinStatus.active) {
					return res.status(400).json({
						error:
							"This creation is pinned on the feed for a challenge and cannot be submitted as a challenge entry."
					});
				}
			} catch {
				// ignore
			}
			if (creationMetaHasChallengeOrganizerRef(meta)) {
				return res.status(400).json({
					error:
						"This creation is used as challenge media (hero, results, or theme vote) and cannot be submitted as an entry."
				});
			}

			const v = await validateChallengeSubmission({
				sb,
				userId: user.id,
				ownerUserId: image.user_id,
				creationId: imageId,
				meta,
				threadId,
				note: noteRaw,
				challengeId: requestedChallengeId || undefined,
				mediaType: creationMediaTypeFromMeta(meta)
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

			const removeIdsByThread = new Map();
			for (const r of toRemove) {
				const tid = Number(r.thread_id);
				const mid = Number(r.message_id);
				if (!Number.isFinite(mid) || mid <= 0 || !Number.isFinite(tid) || tid <= 0) continue;
				const list = removeIdsByThread.get(tid) || [];
				list.push(mid);
				removeIdsByThread.set(tid, list);
			}
			for (const [tid, mids] of removeIdsByThread) {
				await repairLastReadPointersForDeletedMessages({
					sb,
					threadId: tid,
					deleteMessageIds: mids
				});
				await sb
					.from("prsn_chat_messages")
					.delete()
					.in("id", mids)
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
router.appendEligibility = appendChallengeSubmitEligibility;
return router;
}
