/**
 * Challenge organizer routes (new surface — organize pins + stats migrate here
 * when touched; do not grow chat.js).
 *
 * POST .../publish-results
 *   Save the results/payout draft (phase stays Pending). With save_only, persists
 *   recipients without paying (also updates unpaid rows on an existing draft).
 *   Otherwise optionally pays one row via pay_only_index. Does NOT stamp
 *   results_published_at — that is finalize-results.
 *
 * POST .../retry-unpaid
 *   Pay pending payout rows (works before or after finalize).
 *
 * POST .../finalize-results
 *   Pending → Complete. Requires every payout paid. Stamps results_published_at
 *   only (pinning / announce come later).
 */

import express from "express";
import { getSupabaseServiceClient } from "./utils/supabaseService.js";
import {
	fetchThreadMessagesChronological,
	fetchChatChannelThreadRow,
	resolveChallengeOrganizerAllowlistFromMessages,
	pickLatestChallengesGlobalConfigPayload,
	resolveOrganizersByTrackFromGlobalPayload,
	viewerOrganizesTrack,
	tryParseChallengeJsonBody
} from "./utils/challengeSubmitShared.js";
import {
	mergeFullChallengeConfigForChallenge,
	isChallengeConfigSoftDeleted,
	isChallengeConfigPurged,
	viewerCanManageChallengePayouts
} from "../src/chat/challenges/challengeAdmin.js";
import { deriveChallengePhase } from "../src/chat/challenges/model/phases.js";
import { collectChallengeVoteStats } from "../src/chat/challenges/model/ranking.js";
import {
	prepareChallengeResultsPublish,
	executeChallengePayouts,
	pendingPayoutRows,
	mergeResultsPreservingPaid
} from "./utils/challengePayouts.js";

export default function createChallengesRoutes({ queries }) {
	const router = express.Router();

	function requireUser(req, res) {
		const userId = req.auth?.userId;
		if (!userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}
		return userId;
	}

	function getSb(res) {
		const sb = getSupabaseServiceClient();
		if (!sb) {
			res.status(503).json({ error: "Service unavailable", message: "Database not configured" });
			return null;
		}
		return sb;
	}

	function readPublishedAt(merged) {
		return merged?.results_published_at != null
			? String(merged.results_published_at).trim()
			: "";
	}

	function hasResultsDraft(merged) {
		const results = merged?.results && typeof merged.results === "object" ? merged.results : null;
		return Boolean(results && Array.isArray(results.payouts) && results.payouts.length > 0);
	}

	/**
	 * Persist results onto the latest config message.
	 * `publishedAtIso`: string to stamp finalize; `null` to keep draft (no published_at);
	 * omit via undefined is not used — always pass null or iso.
	 */
	async function persistChallengeResults(sb, ctx, results, publishedAtIso, expectedBody) {
		const payload = {
			...ctx.merged,
			kind: "challenge_config",
			challenge_id: ctx.challengeId,
			results
		};
		if (publishedAtIso) {
			payload.results_published_at = publishedAtIso;
		} else {
			delete payload.results_published_at;
		}
		let q = sb
			.from("prsn_chat_messages")
			.update({ body: JSON.stringify(payload) })
			.eq("id", ctx.configMessage.id);
		if (expectedBody != null) q = q.eq("body", expectedBody);
		const { data, error } = await q.select("id");
		if (error) throw error;
		if (expectedBody != null && (!Array.isArray(data) || data.length === 0)) {
			const conflict = new Error("Challenge config changed while publishing. Reload and retry.");
			conflict.code = "PUBLISH_CONFLICT";
			throw conflict;
		}
		ctx.configMessage.body = JSON.stringify(payload);
		ctx.merged = payload;

		// Keep a single challenge_config message per challenge_id.
		try {
			const tid = Number(ctx.threadId);
			const keepId = Number(ctx.configMessage.id);
			const cid = String(ctx.challengeId || "").trim();
			if (Number.isFinite(tid) && tid > 0 && Number.isFinite(keepId) && keepId > 0 && cid) {
				const messages = await fetchThreadMessagesChronological(sb, tid);
				const drop = [];
				for (const m of messages) {
					const p = tryParseChallengeJsonBody(m?.body);
					if (
						!p ||
						String(p.kind || "").trim() !== "challenge_config" ||
						String(p.challenge_id || "").trim() !== cid
					) {
						continue;
					}
					const mid = Number(m?.id);
					if (Number.isFinite(mid) && mid > 0 && mid !== keepId) drop.push(mid);
				}
				if (drop.length) {
					const { error: delErr } = await sb
						.from("prsn_chat_messages")
						.delete()
						.in("id", drop)
						.eq("thread_id", tid);
					if (delErr) throw delErr;
				}
			}
		} catch (collapseErr) {
			console.warn(
				"[challenges] collapse duplicate configs",
				collapseErr?.message || collapseErr
			);
		}
	}

	async function resolveAdminPayoutUserId(sb) {
		const { data, error } = await sb
			.from("prsn_users")
			.select("id")
			.eq("role", "admin")
			.order("id", { ascending: true })
			.limit(1)
			.maybeSingle();
		if (error) throw error;
		const id = Number(data?.id);
		return Number.isFinite(id) && id > 0 ? id : null;
	}

	async function requireAdminPayoutSource(res, sb, totalAmount) {
		const adminUserId = await resolveAdminPayoutUserId(sb);
		if (adminUserId == null) {
			res.status(503).json({
				error: "Service unavailable",
				message: "No admin account found to fund payouts."
			});
			return null;
		}
		if (totalAmount > 0) {
			try {
				const credits = await queries.selectUserCredits.get(adminUserId);
				const balance = Number(credits?.balance) || 0;
				if (balance < totalAmount) {
					res.status(400).json({
						error: "Insufficient credits",
						message: `Payouts total ${totalAmount} credits but the admin account balance is ${balance}.`
					});
					return null;
				}
			} catch {
				// Balance check is advisory; transferCredits enforces for real.
			}
		}
		return adminUserId;
	}

	async function loadOrganizerChallengeContext(req, res, userId, sb) {
		const threadId = Number(req.params.threadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			res.status(400).json({ error: "Bad request", message: "Invalid thread id" });
			return null;
		}
		const challengeId = String(req.params.challengeId || "").trim();
		if (!challengeId) {
			res.status(400).json({ error: "Bad request", message: "Invalid challenge id" });
			return null;
		}

		const threadRow = await fetchChatChannelThreadRow(sb, threadId);
		const slug = String(threadRow?.channel_slug || "").toLowerCase();
		if (!threadRow || threadRow.type !== "channel" || slug !== "challenges") {
			res.status(404).json({ error: "Not found", message: "Challenges channel missing" });
			return null;
		}

		const profile =
			typeof queries?.selectUserProfileByUserId?.get === "function"
				? await queries.selectUserProfileByUserId.get(userId)
				: null;
		const viewerUserName =
			typeof profile?.user_name === "string" ? profile.user_name.trim().toLowerCase() : "";
		if (!viewerUserName) {
			res.status(403).json({ error: "Forbidden", message: "Username required" });
			return null;
		}

		const messages = await fetchThreadMessagesChronological(sb, threadId);
		const allow = resolveChallengeOrganizerAllowlistFromMessages(messages);
		if (!new Set(allow).has(viewerUserName)) {
			res.status(403).json({ error: "Forbidden", message: "Not a challenge organizer" });
			return null;
		}

		const configEntries = [];
		let configMessage = null;
		for (const msg of messages) {
			const payload = tryParseChallengeJsonBody(msg?.body);
			if (!payload || String(payload.kind || "").trim() !== "challenge_config") continue;
			configEntries.push({ msg, payload });
			if (String(payload.challenge_id || "").trim() === challengeId) {
				configMessage = msg;
			}
		}
		const merged = mergeFullChallengeConfigForChallenge(configEntries, challengeId);
		if (!configMessage || !merged || Object.keys(merged).length === 0) {
			res.status(404).json({ error: "Not found", message: "Challenge not found" });
			return null;
		}
		if (isChallengeConfigSoftDeleted(merged) || isChallengeConfigPurged(merged)) {
			res.status(400).json({ error: "Bad request", message: "Challenge is deleted" });
			return null;
		}

		const globalPayload = pickLatestChallengesGlobalConfigPayload(messages)?.payload;
		const organizersByTrack = resolveOrganizersByTrackFromGlobalPayload(globalPayload);
		if (!viewerOrganizesTrack(viewerUserName, organizersByTrack, merged.track || "monthly")) {
			res.status(403).json({ error: "Forbidden", message: "Not an organizer for this track" });
			return null;
		}

		if (!viewerCanManageChallengePayouts(viewerUserName)) {
			res.status(403).json({
				error: "Forbidden",
				message: "Only oceanman or admin can manage challenge payouts."
			});
			return null;
		}

		return {
			threadId,
			challengeId,
			merged,
			viewerUserName,
			configMessage: { id: Number(configMessage.id), body: String(configMessage.body) },
			messages
		};
	}

	function parsePayOnlyIndex(body) {
		const payOnlyRaw = body?.pay_only_index;
		if (payOnlyRaw == null || payOnlyRaw === "") return null;
		return Number.isFinite(Number(payOnlyRaw)) ? Math.floor(Number(payOnlyRaw)) : null;
	}

	router.post(
		"/api/chat/challenges/organize/:threadId/:challengeId/publish-results",
		async (req, res) => {
			const userId = requireUser(req, res);
			if (userId == null) return;
			const sb = getSb(res);
			if (!sb) return;

			try {
				const ctx = await loadOrganizerChallengeContext(req, res, userId, sb);
				if (!ctx) return;

				const phase = deriveChallengePhase(ctx.merged, Date.now());
				if (phase !== "finalizing") {
					return res.status(400).json({
						error: "Bad request",
						message:
							phase === "results"
								? "Challenge is already finalized."
								: `Challenge is not awaiting results (phase: ${phase}).`
					});
				}
				if (readPublishedAt(ctx.merged)) {
					return res.status(400).json({
						error: "Bad request",
						message: "Challenge is already finalized."
					});
				}
				const body = req.body && typeof req.body === "object" ? req.body : {};
				const saveOnly = body.save_only === true || body.save_only === "true";
				const payOnlyIndex = parsePayOnlyIndex(body);
				const existingDraft = hasResultsDraft(ctx.merged);

				if (existingDraft && !saveOnly) {
					return res.status(400).json({
						error: "Bad request",
						message: "Payout list already saved — pay unpaid rows, or finalize when done."
					});
				}

				const stats = collectChallengeVoteStats(ctx.messages, ctx.challengeId);
				const prep = prepareChallengeResultsPublish({
					merged: {
						...ctx.merged,
						// Allow re-prep while a draft exists (save_only update path).
						results_published_at: undefined
					},
					body,
					stats,
					confirmedByUserId: userId
				});
				if (!prep.ok) {
					return res.status(400).json({ error: "Bad request", message: prep.error });
				}

				let results = prep.results;
				if (existingDraft) {
					const merged = mergeResultsPreservingPaid(ctx.merged.results, prep.results);
					if (!merged.ok) {
						return res.status(400).json({ error: "Bad request", message: merged.error });
					}
					results = merged.results;
				}

				// Draft results only — do not stamp results_published_at (stays Pending).
				const originalBody = ctx.configMessage.body;
				try {
					await persistChallengeResults(sb, ctx, results, null, originalBody);
				} catch (err) {
					if (err?.code === "PUBLISH_CONFLICT") {
						return res.status(409).json({ error: "Conflict", message: err.message });
					}
					throw err;
				}

				if (saveOnly) {
					return res.status(200).json({
						ok: true,
						results,
						totalAmount: prep.totalAmount,
						paid: 0,
						failed: [],
						finalized: false,
						saved: true
					});
				}

				const amountToFund =
					payOnlyIndex != null
						? Number(results.payouts?.[payOnlyIndex]?.amount) || 0
						: pendingPayoutRows(results).reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
				const adminUserId = await requireAdminPayoutSource(res, sb, amountToFund);
				if (adminUserId == null) return;

				const payoutResult = await executeChallengePayouts({
					queries,
					results,
					source: { type: "tip", fromUserId: adminUserId },
					challengeId: ctx.challengeId,
					challengeTitle: ctx.merged.title,
					onlyIndex: payOnlyIndex,
					afterRowPaid: (updated) => persistChallengeResults(sb, ctx, updated, null, null)
				});
				await persistChallengeResults(sb, ctx, results, null, null);

				return res.status(200).json({
					ok: true,
					results,
					totalAmount: prep.totalAmount,
					paid: payoutResult.paid,
					failed: payoutResult.failed,
					finalized: false
				});
			} catch (err) {
				console.error("[POST .../publish-results]", err);
				return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
			}
		}
	);

	router.post(
		"/api/chat/challenges/organize/:threadId/:challengeId/retry-unpaid",
		async (req, res) => {
			const userId = requireUser(req, res);
			if (userId == null) return;
			const sb = getSb(res);
			if (!sb) return;

			try {
				const ctx = await loadOrganizerChallengeContext(req, res, userId, sb);
				if (!ctx) return;

				const results =
					ctx.merged.results && typeof ctx.merged.results === "object"
						? ctx.merged.results
						: null;
				if (!results || !Array.isArray(results.payouts) || results.payouts.length === 0) {
					return res.status(400).json({
						error: "Bad request",
						message: "No payout list saved yet."
					});
				}
				const publishedAtIso = readPublishedAt(ctx.merged) || null;
				const pending = pendingPayoutRows(results);
				if (pending.length === 0) {
					return res.status(200).json({ ok: true, paid: 0, failed: [], results });
				}

				const body = req.body && typeof req.body === "object" ? req.body : {};
				const payOnlyIndex = parsePayOnlyIndex(body);
				const amountToFund =
					payOnlyIndex != null
						? Number(results.payouts?.[payOnlyIndex]?.amount) || 0
						: pending.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
				const adminUserId = await requireAdminPayoutSource(res, sb, amountToFund);
				if (adminUserId == null) return;

				const payoutResult = await executeChallengePayouts({
					queries,
					results,
					source: { type: "tip", fromUserId: adminUserId },
					challengeId: ctx.challengeId,
					challengeTitle: ctx.merged.title,
					onlyIndex: payOnlyIndex,
					afterRowPaid: (updated) =>
						persistChallengeResults(sb, ctx, updated, publishedAtIso, null)
				});
				await persistChallengeResults(sb, ctx, results, publishedAtIso, null);

				return res.status(200).json({
					ok: true,
					paid: payoutResult.paid,
					failed: payoutResult.failed,
					results
				});
			} catch (err) {
				console.error("[POST .../retry-unpaid]", err);
				return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
			}
		}
	);

	router.post(
		"/api/chat/challenges/organize/:threadId/:challengeId/finalize-results",
		async (req, res) => {
			const userId = requireUser(req, res);
			if (userId == null) return;
			const sb = getSb(res);
			if (!sb) return;

			try {
				const ctx = await loadOrganizerChallengeContext(req, res, userId, sb);
				if (!ctx) return;

				const phase = deriveChallengePhase(ctx.merged, Date.now());
				if (phase === "results" || readPublishedAt(ctx.merged)) {
					return res.status(400).json({
						error: "Bad request",
						message: "Challenge is already finalized."
					});
				}
				if (phase !== "finalizing") {
					return res.status(400).json({
						error: "Bad request",
						message: `Challenge is not awaiting results (phase: ${phase}).`
					});
				}

				const results =
					ctx.merged.results && typeof ctx.merged.results === "object"
						? ctx.merged.results
						: null;
				if (!results || !Array.isArray(results.payouts) || results.payouts.length === 0) {
					return res.status(400).json({
						error: "Bad request",
						message: "Save and pay out prizes before finalizing."
					});
				}
				const pending = pendingPayoutRows(results);
				if (pending.length > 0) {
					return res.status(400).json({
						error: "Bad request",
						message: `Pay all prizes before finalizing (${pending.length} still unpaid).`
					});
				}

				const publishedAtIso = new Date().toISOString();
				const originalBody = ctx.configMessage.body;
				try {
					await persistChallengeResults(sb, ctx, results, publishedAtIso, originalBody);
				} catch (err) {
					if (err?.code === "PUBLISH_CONFLICT") {
						return res.status(409).json({ error: "Conflict", message: err.message });
					}
					throw err;
				}

				return res.status(200).json({
					ok: true,
					results,
					results_published_at: publishedAtIso
				});
			} catch (err) {
				console.error("[POST .../finalize-results]", err);
				return res.status(500).json({ error: "Server error", message: err?.message || "Failed" });
			}
		}
	);

	return router;
}
