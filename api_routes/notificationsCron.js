import express from "express";
import { sendTemplatedEmail } from "../email/index.js";
import { getBaseAppUrl } from "./utils/url.js";
import { getCronDigestSettings, getEffectiveEmailRecipient } from "./utils/emailSettings.js";

const CRON_SECRET_ENV = "CRON_SECRET";
const DIGEST_ACTIVITY_HOURS_LOOKBACK = 24;

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
		const secret = process.env[CRON_SECRET_ENV];
		const authHeader = req.get?.("Authorization") || req.headers?.authorization || "";
		const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
		if (!secret || token !== secret) {
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

		const candidateRows = await (queries.selectDistinctUserIdsWithUnreadNotificationsSince?.all(sinceIso) ?? []);
		const userIds = candidateRows.map((r) => r?.user_id).filter((id) => id != null && Number.isFinite(Number(id)));

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
			if (queries.upsertUserEmailCampaignStateLastDigest?.run) {
				await queries.upsertUserEmailCampaignStateLastDigest.run(userId, sentAt);
			}

			if (!dryRun && process.env.RESEND_API_KEY && process.env.RESEND_SYSTEM_EMAIL) {
				const to = await getEffectiveEmailRecipient(queries, email);
				const recipientName = user?.display_name || user?.user_name || email.split("@")[0] || "there";
				const feedUrl = getBaseAppUrl();
				try {
					await sendTemplatedEmail({
						to,
						template: "digestActivity",
						data: {
							recipientName,
							activitySummary: "You have new activity on your creations.",
							feedUrl
						}
					});
					sent++;
				} catch (err) {
					// Log but don't fail the cron
					skipped++;
				}
			}
		}

		res.json({
			ok: true,
			dryRun,
			inWindow: true,
			candidates: userIds.length,
			sent,
			skipped
		});
	});

	return router;
}
