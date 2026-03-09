import "dotenv/config";
import { openDb } from "../db/index.js";

async function main() {
	const raw = process.argv[2];
	const userId = Number(raw);
	if (!Number.isFinite(userId) || userId <= 0) {
		console.error("Usage: node scripts/debug-first-creation-nudge.js <userId>");
		process.exit(1);
	}

	const { db, queries } = await openDb({ quiet: true });

	function logSection(title) {
		console.log("\n=== " + title + " ===");
	}

	logSection("User");
	const user = await queries.selectUserById?.get(userId);
	console.log(user ?? "(no user row)");

	logSection("Email campaign state (email_user_campaign_state)");
	const state = await queries.selectUserEmailCampaignState?.get(userId);
	console.log(state ?? "(no state row)");

	logSection("Email sends for user (email_sends)");
	const emailSends = await queries.listEmailSendsRecent?.all(500, 0, "created_at", "asc");
	const sendsForUser = (emailSends ?? []).filter((r) => Number(r?.user_id) === userId);
	console.table(
		sendsForUser.map((r) => ({
			id: r.id,
			campaign: r.campaign,
			created_at: r.created_at
		}))
	);

	logSection("Created image counts");
	const allCountRow = await queries.selectAllCreatedImageCountForUser?.get(userId);
	const publishedCountRow = await queries.selectPublishedCreatedImageCountForUser?.get(userId);
	const publishedNonWelcomeRow = await queries.selectPublishedNonWelcomeCreationCountForUser?.get(userId);
	console.log("All (visible) creations count:", allCountRow?.count ?? 0);
	console.log("Published creations count:", publishedCountRow?.count ?? 0);
	console.log("Published non-welcome (nudge-disqualifying) count:", publishedNonWelcomeRow?.count ?? 0);

	if (queries.selectCreatedImagesForUser?.all) {
		logSection("Sample created_images rows for this user");
		const createdImagesSample = await queries.selectCreatedImagesForUser.all(userId, {
			limit: 25,
			offset: 0,
			includeUnavailable: true
		});
		console.table(
			(createdImagesSample ?? []).map((img) => ({
				id: img.id,
				status: img.status,
				created_at: img.created_at,
				published: img.published,
				published_at: img.published_at,
				unavailable_at: img.unavailable_at,
				title: img.title
			}))
		);
	}

	logSection("Eligibility check according to selectUsersEligibleForFirstCreationNudge");
	const now = new Date();
	now.setUTCHours(now.getUTCHours() - 24, now.getUTCMinutes(), now.getUTCSeconds(), 0);
	const cutoffIso = now.toISOString();
	const eligibleRows = await queries.selectUsersEligibleForFirstCreationNudge?.all(cutoffIso);
	const isEligible = (eligibleRows ?? []).some((r) => Number(r?.user_id) === userId);
	console.log("Eligible right now?", isEligible);

	if (isEligible) {
		console.log(
			"Reason: welcome_email_sent_at is set and older than cutoff, first_creation_nudge_sent_at is NULL,",
			"and user has zero published non-welcome creations (avatar and unpublished try creations do not count)."
		);
	} else {
		console.log("User is not currently eligible according to the adapter query.");
	}

	if (typeof db.close === "function") {
		db.close();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

