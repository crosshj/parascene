import express from "express";
import { sendTemplatedEmail } from "../email/index.js";
import { getBaseAppUrl } from "./utils/url.js";
import {
	getCronDigestSettings,
	getEffectiveEmailRecipient,
	getWelcomeEmailDelayHours,
	getReengagementInactiveDays,
	getReengagementCooldownDays,
	getCreationHighlightLookbackHours,
	getCreationHighlightCooldownDays
} from "./utils/emailSettings.js";
import { markPreviousStepsCompleted } from "./utils/emailCampaignState.js";
import { verifyQStashRequest } from "./utils/qstashVerification.js";

const CRON_SECRET_ENV = "CRON_SECRET";
const DIGEST_ACTIVITY_HOURS_LOOKBACK = 24;

/** Authorize cron request: local uses CRON_SECRET Bearer; prod uses Upstash QStash signature (same as try/worker, create). */
async function authorizeCronRequest(req) {
	const secret = process.env[CRON_SECRET_ENV];
	const authHeader = req.get?.("Authorization") || req.headers?.authorization || "";
	const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
	if (secret && token === secret) {
		return true;
	}
	return await verifyQStashRequest(req);
}

function getStartOfTodayUTC() {
	const d = new Date();
	d.setUTCHours(0, 0, 0, 0);
	return d.toISOString();
}

function getSinceIso(hoursAgo = DIGEST_ACTIVITY_HOURS_LOOKBACK) {
	const d = new Date();
	d.setUTCHours(d.getUTCHours() - hoursAgo, d.getUTCMinutes(), d.getUTCSeconds(), 0);
	return d.toISOString();
}

export default function createNotificationsCronRoutes({ queries }) {
	const router = express.Router();

	router.post("/api/notifications/cron", async (req, res) => {
		console.log("notificationsCron", req.body);

		const authorized = await authorizeCronRequest(req);
		console.log("authorized", authorized);

		if (!authorized) {
			res.status(401).json({ error: "Unauthorized" });
			return;
		}

		const { dryRun, windowHours, maxDigestsPerUserPerDay } = await getCronDigestSettings(queries);
		const now = new Date();
		const currentHourUTC = now.getUTCHours();
		const inWindow = windowHours.length === 0 || windowHours.includes(currentHourUTC);
		if (!inWindow) {
			res.json({ ok: true, reason: "not_in_window", currentHourUTC, windowHours });
			return;
		}

		const startOfTodayUTC = getStartOfTodayUTC();
		const sinceIso = getSinceIso();
		let sent = 0;
		let skipped = 0;
		let welcomeSent = 0;
		let firstCreationNudgeSent = 0;
		let reengagementSent = 0;
		let creationHighlightSent = 0;

		const candidateRows = await (queries.selectDistinctUserIdsWithUnreadNotificationsSince?.all(sinceIso) ?? []);
		const userIds = candidateRows.map((r) => r?.user_id).filter((id) => id != null && Number.isFinite(Number(id)));

		// Users who will receive a "later" campaign this run: we mark previous steps done and do NOT send welcome/first-nudge to them this run
		const reengagementInactiveDays = await getReengagementInactiveDays(queries);
		const reengagementCooldownDays = await getReengagementCooldownDays(queries);
		const inactiveCutoff = new Date();
		inactiveCutoff.setUTCDate(inactiveCutoff.getUTCDate() - reengagementInactiveDays);
		const reengagementCooldownCutoff = new Date();
		reengagementCooldownCutoff.setUTCDate(reengagementCooldownCutoff.getUTCDate() - reengagementCooldownDays);
		const reengagementEligibleRows = await (queries.selectUsersEligibleForReengagement?.all(
			inactiveCutoff.toISOString(),
			reengagementCooldownCutoff.toISOString()
		) ?? []);
		const highlightLookbackHours = await getCreationHighlightLookbackHours(queries);
		const highlightCooldownDays = await getCreationHighlightCooldownDays(queries);
		const highlightSince = new Date();
		highlightSince.setUTCHours(highlightSince.getUTCHours() - highlightLookbackHours, highlightSince.getUTCMinutes(), highlightSince.getUTCSeconds(), 0);
		const highlightCooldownCutoff = new Date();
		highlightCooldownCutoff.setUTCDate(highlightCooldownCutoff.getUTCDate() - highlightCooldownDays);
		const highlightEligibleRows = await (queries.selectCreationsEligibleForHighlight?.all(
			highlightSince.toISOString(),
			highlightCooldownCutoff.toISOString()
		) ?? []);
		const userIdsReceivingLaterCampaignThisRun = new Set([
			...reengagementEligibleRows.map((r) => r?.user_id).filter((id) => id != null),
			...highlightEligibleRows.map((r) => r?.user_id).filter((id) => id != null)
		]);

		for (const userId of userIds) {
			const user = await queries.selectUserById?.get(userId);
			const email = user?.email ? String(user.email).trim() : "";
			if (!email || !email.includes("@")) {
				skipped++;
				continue;
			}

			const countRow = await queries.selectEmailSendsCountForUserSince?.get(userId, "digest", startOfTodayUTC);
			const countToday = Number(countRow?.count ?? 0);
			if (countToday >= maxDigestsPerUserPerDay) {
				skipped++;
				continue;
			}

			const result = await queries.insertEmailSend?.run(userId, "digest", null);
			const sendId = result?.insertId ?? result?.lastInsertRowid;
			const sentAt = new Date().toISOString();

			if (!dryRun && process.env.RESEND_API_KEY && process.env.RESEND_SYSTEM_EMAIL) {
				const to = await getEffectiveEmailRecipient(queries, email);
				const recipientName = user?.display_name || user?.user_name || email.split("@")[0] || "there";
				const feedUrl = getBaseAppUrl();
				const ownerRows = await (queries.selectDigestActivityByOwnerSince?.all(userId, sinceIso) ?? []);
				const commenterRows = await (queries.selectDigestActivityByCommenterSince?.all(userId, sinceIso) ?? []);
				const activityItems = ownerRows.map((r) => ({
					title: r?.title && String(r.title).trim() ? String(r.title).trim() : "Untitled",
					comment_count: Number(r?.comment_count ?? 0)
				}));
				const otherCreationsActivityItems = commenterRows.map((r) => ({
					title: r?.title && String(r.title).trim() ? String(r.title).trim() : "Untitled",
					comment_count: Number(r?.comment_count ?? 0)
				}));
				try {
					await sendTemplatedEmail({
						to,
						template: "digestActivity",
						data: {
							recipientName,
							activitySummary: "You have new activity.",
							feedUrl,
							activityItems,
							otherCreationsActivityItems
						}
					});
					if (queries.upsertUserEmailCampaignStateLastDigest?.run) {
						await queries.upsertUserEmailCampaignStateLastDigest.run(userId, sentAt);
					}
					await markPreviousStepsCompleted(queries, userId, sentAt, "digest");
					userIdsReceivingLaterCampaignThisRun.add(userId);
					sent++;
				} catch (err) {
					// Log but don't fail the cron
					skipped++;
				}
			}
		}

		// Welcome email: users who have never been sent welcome and (optionally) signed up at least delay hours ago
		const welcomeDelayHours = await getWelcomeEmailDelayHours(queries);
		const welcomeCutoff = new Date();
		welcomeCutoff.setUTCHours(welcomeCutoff.getUTCHours() - welcomeDelayHours, welcomeCutoff.getUTCMinutes(), welcomeCutoff.getUTCSeconds(), 0);
		const welcomeCutoffIso = welcomeCutoff.toISOString();
		const welcomeEligibleRows = await (queries.selectUsersEligibleForWelcomeEmail?.all(welcomeCutoffIso) ?? []);
		for (const row of welcomeEligibleRows) {
			const userId = row?.user_id;
			if (userId == null || !Number.isFinite(Number(userId))) continue;
			if (userIdsReceivingLaterCampaignThisRun.has(userId)) continue;
			const user = await queries.selectUserById?.get(userId);
			const email = user?.email ? String(user.email).trim() : "";
			if (!email || !email.includes("@")) continue;
			if (!dryRun && process.env.RESEND_API_KEY && process.env.RESEND_SYSTEM_EMAIL) {
				try {
					const to = await getEffectiveEmailRecipient(queries, email);
					const recipientName = user?.display_name || user?.user_name || email.split("@")[0] || "there";
					await sendTemplatedEmail({
						to,
						template: "welcome",
						data: { recipientName }
					});
					await queries.insertEmailSend?.run(userId, "welcome", null);
					const sentAt = new Date().toISOString();
					if (queries.upsertUserEmailCampaignStateWelcome?.run) {
						await queries.upsertUserEmailCampaignStateWelcome.run(userId, sentAt);
					}
					welcomeSent++;
				} catch (err) {
					// skip on failure
				}
			}
		}

		// First-creation nudge: users with no creations who have never been sent the nudge.
		// Only nudge if welcome was sent at least 24h ago so we never send welcome + nudge in the same run.
		const nudgeWelcomeCutoff = new Date();
		nudgeWelcomeCutoff.setUTCHours(nudgeWelcomeCutoff.getUTCHours() - 24, nudgeWelcomeCutoff.getUTCMinutes(), nudgeWelcomeCutoff.getUTCSeconds(), 0);
		const nudgeEligibleRows = await (queries.selectUsersEligibleForFirstCreationNudge?.all(nudgeWelcomeCutoff.toISOString()) ?? []);
		for (const row of nudgeEligibleRows) {
			const userId = row?.user_id;
			if (userId == null || !Number.isFinite(Number(userId))) continue;
			if (userIdsReceivingLaterCampaignThisRun.has(userId)) continue;
			const user = await queries.selectUserById?.get(userId);
			const email = user?.email ? String(user.email).trim() : "";
			if (!email || !email.includes("@")) continue;
			if (!dryRun && process.env.RESEND_API_KEY && process.env.RESEND_SYSTEM_EMAIL) {
				try {
					const to = await getEffectiveEmailRecipient(queries, email);
					const recipientName = user?.display_name || user?.user_name || email.split("@")[0] || "there";
					await sendTemplatedEmail({
						to,
						template: "firstCreationNudge",
						data: { recipientName }
					});
					await queries.insertEmailSend?.run(userId, "first_creation_nudge", null);
					const sentAt = new Date().toISOString();
					if (queries.upsertUserEmailCampaignStateFirstCreationNudge?.run) {
						await queries.upsertUserEmailCampaignStateFirstCreationNudge.run(userId, sentAt);
					}
					firstCreationNudgeSent++;
				} catch (err) {
					// skip on failure
				}
			}
		}

		// Re-engagement: inactive users with at least one creation; cooldown between sends
		for (const row of reengagementEligibleRows) {
			const userId = row?.user_id;
			if (userId == null || !Number.isFinite(Number(userId))) continue;
			const user = await queries.selectUserById?.get(userId);
			const email = user?.email ? String(user.email).trim() : "";
			if (!email || !email.includes("@")) continue;
			if (!dryRun && process.env.RESEND_API_KEY && process.env.RESEND_SYSTEM_EMAIL) {
				try {
					const to = await getEffectiveEmailRecipient(queries, email);
					const recipientName = user?.display_name || user?.user_name || email.split("@")[0] || "there";
					await sendTemplatedEmail({
						to,
						template: "reengagement",
						data: { recipientName }
					});
					await queries.insertEmailSend?.run(userId, "reengagement", null);
					const sentAt = new Date().toISOString();
					if (queries.upsertUserEmailCampaignStateReengagement?.run) {
						await queries.upsertUserEmailCampaignStateReengagement.run(userId, sentAt);
					}
					await markPreviousStepsCompleted(queries, userId, sentAt, "reengagement");
					reengagementSent++;
				} catch (err) {
					// skip on failure
				}
			}
		}

		// Creation highlight: creators whose creation got recent comments; one per owner per cooldown
		for (const row of highlightEligibleRows) {
			const userId = row?.user_id;
			if (userId == null || !Number.isFinite(Number(userId))) continue;
			const user = await queries.selectUserById?.get(userId);
			const email = user?.email ? String(user.email).trim() : "";
			if (!email || !email.includes("@")) continue;
			if (!dryRun && process.env.RESEND_API_KEY && process.env.RESEND_SYSTEM_EMAIL) {
				try {
					const to = await getEffectiveEmailRecipient(queries, email);
					const recipientName = user?.display_name || user?.user_name || email.split("@")[0] || "there";
					const creationTitle = row?.title && String(row.title).trim() ? String(row.title).trim() : "Untitled";
					const creationId = row?.creation_id;
					const creationUrl = creationId != null ? `${getBaseAppUrl()}/creations/${creationId}` : getBaseAppUrl();
					await sendTemplatedEmail({
						to,
						template: "creationHighlight",
						data: {
							recipientName,
							creationTitle,
							creationUrl,
							commentCount: Number(row?.comment_count ?? 0) || 1
						}
					});
					await queries.insertEmailSend?.run(userId, "creation_highlight", null);
					const sentAt = new Date().toISOString();
					if (queries.upsertUserEmailCampaignStateCreationHighlight?.run) {
						await queries.upsertUserEmailCampaignStateCreationHighlight.run(userId, sentAt);
					}
					await markPreviousStepsCompleted(queries, userId, sentAt, "creation_highlight");
					creationHighlightSent++;
				} catch (err) {
					// skip on failure
				}
			}
		}

		res.json({
			ok: true,
			dryRun,
			inWindow: true,
			candidates: userIds.length,
			sent,
			skipped,
			welcomeSent,
			firstCreationNudgeSent,
			reengagementSent,
			creationHighlightSent
		});
	});

	return router;
}
