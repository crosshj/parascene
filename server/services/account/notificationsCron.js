import { sendTemplatedEmail } from "../../email/index.js";
import { getBaseAppUrlForEmail } from "../create/url.js";
import { parseDigestHours, runWelcomeMail } from "./welcomeMail.js";

const TEST_ADDRESS = "delivered@resend.dev";
const PAGE = 1000;
const SETTINGS_KEYS = [
	"email_use_test_recipient",
	"email_dry_run",
	"digest_utc_windows",
	"max_digests_per_user_per_day",
	"digest_activity_hours_lookback",
	"welcome_email_delay_hours",
	"reengagement_inactive_days",
	"reengagement_cooldown_days",
	"creation_highlight_lookback_hours",
	"creation_highlight_cooldown_days",
	"creation_highlight_min_comments"
];

function isTrue(value) {
	const text = String(value ?? "").trim().toLowerCase();
	return text === "true" || text === "1";
}

function parseIntSetting(value, fallback, min) {
	const parsed = Number.parseInt(String(value ?? "").trim(), 10);
	return Number.isInteger(parsed) && parsed >= min ? parsed : fallback;
}

function hoursAgo(now, hours) {
	return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function daysAgo(now, days) {
	const date = new Date(now.getTime());
	date.setUTCDate(date.getUTCDate() - days);
	return date.toISOString();
}

function hasEmail(value) {
	return String(value || "").includes("@");
}

async function eachPage(build) {
	const rows = [];
	for (let from = 0; ; from += PAGE) {
		const result = await build(from, from + PAGE - 1);
		if (result.error) throw result.error;
		const data = result.data || [];
		rows.push(...data);
		if (data.length < PAGE) return rows;
	}
}

async function rowsIn(client, table, columns, column, ids) {
	const rows = [];
	const unique = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
	for (let index = 0; index < unique.length; index += 200) {
		const chunk = unique.slice(index, index + 200);
		if (!chunk.length) continue;
		const result = await client.from(table).select(columns).in(column, chunk);
		if (result.error) throw result.error;
		rows.push(...(result.data || []));
	}
	return rows;
}

function settingsFrom(rows) {
	const values = new Map((rows || []).map((row) => [String(row.key || "").trim(), String(row.value ?? "")]));
	const get = (key, fallback) => values.has(key) && values.get(key).trim() ? values.get(key).trim() : fallback;
	return {
		dryRun: isTrue(get("email_dry_run", "true")),
		useTestRecipient: isTrue(get("email_use_test_recipient", "false")),
		windowHours: parseDigestHours(get("digest_utc_windows", "09:00,18:00")),
		maxDigestsPerUserPerDay: parseIntSetting(get("max_digests_per_user_per_day", "2"), 2, 0),
		activityHoursLookback: parseIntSetting(get("digest_activity_hours_lookback", "24"), 24, 1),
		reengagementInactiveDays: parseIntSetting(get("reengagement_inactive_days", "14"), 14, 1),
		reengagementCooldownDays: parseIntSetting(get("reengagement_cooldown_days", "30"), 30, 1),
		creationHighlightLookbackHours: parseIntSetting(get("creation_highlight_lookback_hours", "48"), 48, 1),
		creationHighlightCooldownDays: parseIntSetting(get("creation_highlight_cooldown_days", "7"), 7, 1),
		creationHighlightMinComments: parseIntSetting(get("creation_highlight_min_comments", "1"), 1, 0)
	};
}

async function markEarlierSteps(client, userId, sentAt) {
	const saved = await client.from("prsn_email_user_campaign_state").upsert({
		user_id: userId,
		welcome_email_sent_at: sentAt,
		first_creation_nudge_sent_at: sentAt,
		updated_at: sentAt
	}, { onConflict: "user_id" });
	if (saved.error) throw saved.error;
}

async function recordSend(client, userId, campaign, column) {
	const sentAt = new Date().toISOString();
	const inserted = await client.from("prsn_email_sends").insert({ user_id: userId, campaign, meta: null });
	if (inserted.error) throw inserted.error;
	const saved = await client.from("prsn_email_user_campaign_state").upsert({
		user_id: userId,
		[column]: sentAt,
		updated_at: sentAt
	}, { onConflict: "user_id" });
	if (saved.error) throw saved.error;
	return sentAt;
}

function recipientName(user, profile) {
	const display = String(profile?.display_name || "").trim();
	if (display) return display;
	const handle = String(profile?.user_name || "").trim();
	if (handle) return handle;
	return String(user?.email || "").split("@")[0] || "there";
}

export async function runNotificationsCron({ client, now = new Date(), force = false, deliver = sendTemplatedEmail } = {}) {
	const settingsResult = await client.from("prsn_policy_knobs").select("key,value").in("key", SETTINGS_KEYS);
	if (settingsResult.error) throw settingsResult.error;
	const settings = settingsFrom(settingsResult.data);
	const currentHourUTC = now.getUTCHours();
	if (!force && settings.windowHours.length && !settings.windowHours.includes(currentHourUTC)) {
		return { ok: true, reason: "not_in_window", currentHourUTC, windowHours: settings.windowHours };
	}
	const sinceIso = hoursAgo(now, settings.activityHoursLookback);
	const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
	const base = getBaseAppUrlForEmail().replace(/\/$/, "");
	const unread = await eachPage((from, to) => client.from("prsn_notifications").select("user_id").not("user_id", "is", null).is("acknowledged_at", null).gte("created_at", sinceIso).order("id", { ascending: true }).range(from, to));
	const digestIds = new Set(unread.map((row) => Number(row.user_id)).filter((id) => Number.isFinite(id) && id > 0));
	try {
		const chatIds = await client.rpc("prsn_chat_user_ids_with_digestible_unread", { p_since: sinceIso });
		if (!chatIds.error) for (const row of chatIds.data || []) {
			const id = Number(row?.user_id);
			if (Number.isFinite(id) && id > 0) digestIds.add(id);
		}
	} catch (error) {
		console.warn("[notifications] chat digest candidates failed", error?.message || error);
	}

	const creatorRows = await eachPage((from, to) => client.from("prsn_created_images").select("user_id").order("id", { ascending: true }).range(from, to));
	const creatorIds = [...new Set(creatorRows.map((row) => Number(row.user_id)).filter((id) => Number.isFinite(id) && id > 0))];
	const inactiveCutoff = daysAgo(now, settings.reengagementInactiveDays);
	const reengagementCooldown = daysAgo(now, settings.reengagementCooldownDays);
	const creators = await rowsIn(client, "prsn_users", "id,email,last_active_at,created_at", "id", creatorIds);
	const inactiveIds = creators.filter((user) => hasEmail(user.email) && String(user.last_active_at || user.created_at || "") <= inactiveCutoff).map((user) => user.id);
	const reengagementState = await rowsIn(client, "prsn_email_user_campaign_state", "user_id,welcome_email_sent_at,last_reengagement_sent_at", "user_id", inactiveIds);
	const reengagementByUser = new Map(reengagementState.map((row) => [Number(row.user_id), row]));
	const reengagementIds = inactiveIds.filter((id) => {
		const state = reengagementByUser.get(Number(id));
		if (!state?.welcome_email_sent_at) return false;
		return !state.last_reengagement_sent_at || state.last_reengagement_sent_at <= reengagementCooldown;
	});

	const commentRows = await eachPage((from, to) => client.from("prsn_comments_created_image").select("created_image_id").gte("created_at", hoursAgo(now, settings.creationHighlightLookbackHours)).order("id", { ascending: true }).range(from, to));
	const commentCounts = new Map();
	for (const row of commentRows) commentCounts.set(Number(row.created_image_id), (commentCounts.get(Number(row.created_image_id)) || 0) + 1);
	const hotIds = [...commentCounts.keys()].filter((id) => Number.isFinite(id) && id > 0);
	const hotCreations = await rowsIn(client, "prsn_created_images", "id,user_id,title", "id", hotIds);
	const highlightCooldown = daysAgo(now, settings.creationHighlightCooldownDays);
	const highlightState = await rowsIn(client, "prsn_email_user_campaign_state", "user_id,last_creation_highlight_sent_at", "user_id", hotCreations.map((row) => row.user_id));
	const highlightBlocked = new Set(highlightState.filter((row) => row.last_creation_highlight_sent_at && row.last_creation_highlight_sent_at > highlightCooldown).map((row) => Number(row.user_id)));
	const highlightByOwner = new Map();
	for (const creation of hotCreations) {
		const userId = Number(creation.user_id);
		const count = commentCounts.get(Number(creation.id)) || 0;
		if (!Number.isFinite(userId) || highlightBlocked.has(userId) || count < settings.creationHighlightMinComments) continue;
		const current = highlightByOwner.get(userId);
		if (!current || count > current.comment_count) {
			highlightByOwner.set(userId, { user_id: userId, creation_id: creation.id, title: String(creation.title || "").trim() || "Untitled", comment_count: count });
		}
	}
	const laterIds = new Set([...reengagementIds, ...highlightByOwner.keys()]);
	let sent = 0;
	let skipped = 0;
	const users = new Map((await rowsIn(client, "prsn_users", "id,email,role", "id", [...digestIds, ...reengagementIds, ...highlightByOwner.keys()])).map((user) => [Number(user.id), user]));
	const profiles = new Map((await rowsIn(client, "prsn_user_profiles", "user_id,user_name,display_name", "user_id", [...users.keys()])).map((row) => [Number(row.user_id), row]));
	const canSend = !settings.dryRun && process.env.RESEND_API_KEY && process.env.RESEND_SYSTEM_EMAIL;

	for (const userId of digestIds) {
		const user = users.get(userId);
		if (!hasEmail(user?.email)) { skipped += 1; continue; }
		const count = await client.from("prsn_email_sends").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("campaign", "digest").gte("created_at", startOfToday);
		if (count.error) throw count.error;
		if ((count.count || 0) >= settings.maxDigestsPerUserPerDay) { skipped += 1; continue; }
		const notes = await client.from("prsn_notifications").select("title,message,link,created_at,acknowledged_at").eq("user_id", userId).is("acknowledged_at", null).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(12);
		if (notes.error) throw notes.error;
		const notificationItems = (notes.data || []).map((row) => ({
			title: String(row.title || "Notification").trim(),
			message: String(row.message || "").trim(),
			url: String(row.link || "").startsWith("/") ? `${base}${row.link}` : (row.link || base)
		})).filter((item) => item.title || item.message);
		let chatThreadItems = [];
		try {
			const threads = await client.rpc("prsn_chat_digest_unread_threads", { p_user_id: userId, p_since: sinceIso, p_limit: 8 });
			if (!threads.error) {
				chatThreadItems = (threads.data || []).filter((row) => String(row?.thread_type || "") === "dm").map((row) => ({
					title: "DM",
					unread_count: Number(row.unread_count) || 0,
					thread_url: `${base}/connect`,
					thread_type: "dm"
				}));
			}
		} catch (error) {
			console.warn("[notifications] chat digest threads failed", error?.message || error);
		}
		if (!notificationItems.length && !chatThreadItems.length) { skipped += 1; continue; }
		if (!canSend) continue;
		const to = settings.useTestRecipient ? TEST_ADDRESS : String(user.email).trim();
		const name = recipientName(user, profiles.get(userId));
		try {
			await recordSend(client, userId, "digest", "last_digest_sent_at");
			await deliver({
				to,
				template: "digestActivity",
				data: {
					recipientName: name,
					activitySummary: chatThreadItems.length && notificationItems.length
						? "People on parascene reached out — here's what you missed."
						: chatThreadItems.length ? "You have unread direct messages." : "You have new notifications on parascene.",
					feedUrl: notificationItems[0]?.url || chatThreadItems[0]?.thread_url || base,
					notificationItems,
					chatThreadItems
				}
			});
			await markEarlierSteps(client, userId, new Date().toISOString());
			laterIds.add(userId);
			sent += 1;
		} catch (error) {
			console.warn("[notifications] digest failed", error?.message || error);
			skipped += 1;
		}
	}

	const welcome = await runWelcomeMail({ client, now, force: true, deliver, skipUserIds: laterIds });
	let reengagementSent = 0;
	let creationHighlightSent = 0;
	if (canSend) {
		for (const userId of reengagementIds) {
			const user = users.get(Number(userId));
			if (!hasEmail(user?.email)) continue;
			try {
				await deliver({ to: settings.useTestRecipient ? TEST_ADDRESS : String(user.email).trim(), template: "reengagement", data: { recipientName: recipientName(user, profiles.get(Number(userId))) } });
				const sentAt = await recordSend(client, userId, "reengagement", "last_reengagement_sent_at");
				await markEarlierSteps(client, userId, sentAt);
				reengagementSent += 1;
			} catch (error) {
				console.warn("[notifications] reengagement failed", error?.message || error);
			}
		}
		for (const row of highlightByOwner.values()) {
			const user = users.get(row.user_id);
			if (!hasEmail(user?.email)) continue;
			try {
				await deliver({
					to: settings.useTestRecipient ? TEST_ADDRESS : String(user.email).trim(),
					template: "creationHighlight",
					data: {
						recipientName: recipientName(user, profiles.get(row.user_id)),
						creationTitle: row.title,
						creationUrl: `${base}/creations/${row.creation_id}`,
						commentCount: row.comment_count
					}
				});
				const sentAt = await recordSend(client, row.user_id, "creation_highlight", "last_creation_highlight_sent_at");
				await markEarlierSteps(client, row.user_id, sentAt);
				creationHighlightSent += 1;
			} catch (error) {
				console.warn("[notifications] highlight failed", error?.message || error);
			}
		}
	}

	return {
		ok: welcome.ok !== false,
		dryRun: settings.dryRun,
		inWindow: true,
		currentHourUTC,
		windowHours: settings.windowHours,
		candidates: digestIds.size,
		sent,
		skipped,
		welcomeSent: welcome.welcomeSent || 0,
		firstCreationNudgeSent: welcome.firstCreationNudgeSent || 0,
		reengagementSent,
		creationHighlightSent,
		message: welcome.message
	};
}
