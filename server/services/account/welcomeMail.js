import { isNewUserCreation } from "../../../shared/newUserCreation.js";
import { sendTemplatedEmail } from "../../email/index.js";

const PAGE = 1000;
const TEST_ADDRESS = "delivered@resend.dev";
const SETTINGS_KEYS = ["email_use_test_recipient", "email_dry_run", "digest_utc_windows", "welcome_email_delay_hours"];

function parseNonNegative(value, fallback) {
	const parsed = Number.parseInt(String(value ?? "").trim(), 10);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function isTrue(value) {
	const text = String(value ?? "").trim().toLowerCase();
	return text === "true" || text === "1";
}

function hasEmail(value) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export function parseDigestHours(raw) {
	return String(raw || "")
		.split(",")
		.map((part) => Number.parseInt(part.trim().split(":")[0], 10))
		.filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
}

export function welcomeMailSettings(rows) {
	const values = new Map((rows || []).map((row) => [String(row.key || "").trim(), String(row.value ?? "")]));
	const get = (key, fallback) => values.has(key) && values.get(key).trim() ? values.get(key).trim() : fallback;
	return {
		dryRun: isTrue(get("email_dry_run", "true")),
		useTestRecipient: isTrue(get("email_use_test_recipient", "false")),
		delayHours: parseNonNegative(get("welcome_email_delay_hours", "1"), 1),
		windowHours: parseDigestHours(get("digest_utc_windows", "09:00,18:00"))
	};
}

export function welcomeRecipientIds(users, sentIds) {
	const sent = new Set((sentIds || []).map((id) => String(id)));
	return (users || [])
		.filter((user) => hasEmail(user?.email) && !sent.has(String(user.id)))
		.map((user) => Number(user.id));
}

export function nudgeRecipientIds(stateRows, publishedRows, welcomeSentBeforeIso) {
	const alreadyCreated = new Set();
	for (const row of publishedRows || []) {
		if (row?.user_id == null || isNewUserCreation(row)) continue;
		alreadyCreated.add(String(row.user_id));
	}
	return (stateRows || [])
		.filter((row) => row?.user_id != null)
		.filter((row) => row.welcome_email_sent_at && row.welcome_email_sent_at <= welcomeSentBeforeIso)
		.filter((row) => row.first_creation_nudge_sent_at == null)
		.filter((row) => !alreadyCreated.has(String(row.user_id)))
		.map((row) => Number(row.user_id));
}

async function eachPage(build) {
	const rows = [];
	for (let from = 0; ; from += PAGE) {
		const result = await build().range(from, from + PAGE - 1);
		if (result.error) throw result.error;
		const data = result.data || [];
		rows.push(...data);
		if (data.length < PAGE) return rows;
	}
}

async function rowsIn(client, table, columns, column, ids) {
	const rows = [];
	for (let index = 0; index < ids.length; index += 200) {
		const chunk = ids.slice(index, index + 200);
		if (!chunk.length) continue;
		const result = await client.from(table).select(columns).in(column, chunk);
		if (result.error) throw result.error;
		rows.push(...(result.data || []));
	}
	return rows;
}

function hoursAgo(now, hours) {
	return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function recipientName(user, profile) {
	const display = String(profile?.display_name || "").trim();
	const handle = String(profile?.user_name || "").trim();
	if (display) return display;
	if (handle) return handle;
	return String(user?.email || "").split("@")[0] || "there";
}

async function deliverOne(client, { user, profile, campaign, template, column, settings, deliver }) {
	const intended = String(user.email).trim();
	const to = settings.useTestRecipient ? TEST_ADDRESS : intended;
	await deliver({ to, template, data: { recipientName: recipientName(user, profile) } });
	const sentAt = new Date().toISOString();
	const inserted = await client.from("prsn_email_sends").insert({ user_id: user.id, campaign, meta: null }).select("id").single();
	if (inserted.error) throw inserted.error;
	const saved = await client.from("prsn_email_user_campaign_state").upsert(
		{ user_id: user.id, [column]: sentAt, updated_at: sentAt },
		{ onConflict: "user_id" }
	);
	if (saved.error) throw saved.error;
}

export async function runWelcomeMail({ client, now = new Date(), force = false, deliver = sendTemplatedEmail, skipUserIds = [] } = {}) {
	const settingsResult = await client.from("prsn_policy_knobs").select("key,value").in("key", SETTINGS_KEYS);
	if (settingsResult.error) throw settingsResult.error;
	const settings = welcomeMailSettings(settingsResult.data);
	const currentHour = now.getUTCHours();
	if (!force && settings.windowHours.length && !settings.windowHours.includes(currentHour)) {
		return { ok: true, reason: "not_in_window", currentHourUTC: currentHour, windowHours: settings.windowHours, welcomeSent: 0, firstCreationNudgeSent: 0, message: "Outside the digest window. No welcome mail sent." };
	}
	const welcomeCutoff = hoursAgo(now, settings.delayHours);
	const nudgeCutoff = hoursAgo(now, 24);
	const [users, states, published] = await Promise.all([
		eachPage(() => client.from("prsn_users").select("id,email").not("email", "is", null).lte("created_at", welcomeCutoff).order("id", { ascending: true })),
		eachPage(() => client.from("prsn_email_user_campaign_state").select("user_id,welcome_email_sent_at,first_creation_nudge_sent_at").order("user_id", { ascending: true })),
		eachPage(() => client.from("prsn_created_images").select("user_id,title,filename,meta").eq("published", true).is("unavailable_at", null).order("id", { ascending: true }))
	]);
	const skipped = new Set([...skipUserIds].map((id) => String(id)));
	const welcomeIds = welcomeRecipientIds(users, states.filter((row) => row.welcome_email_sent_at).map((row) => row.user_id)).filter((id) => !skipped.has(String(id)));
	const nudgeIds = nudgeRecipientIds(states, published, nudgeCutoff).filter((id) => !skipped.has(String(id)));
	const ids = [...new Set([...welcomeIds, ...nudgeIds])];
	if (!settings.dryRun && ids.length && (!process.env.RESEND_API_KEY || !process.env.RESEND_SYSTEM_EMAIL)) {
		const error = new Error("Email delivery is not configured (missing Resend environment variables).");
		error.status = 503;
		throw error;
	}
	const profiles = new Map((await rowsIn(client, "prsn_user_profiles", "user_id,user_name,display_name", "user_id", ids)).map((row) => [Number(row.user_id), row]));
	const byId = new Map(users.map((user) => [Number(user.id), user]));
	const missingUserIds = nudgeIds.filter((id) => !byId.has(id));
	for (const user of await rowsIn(client, "prsn_users", "id,email", "id", missingUserIds)) byId.set(Number(user.id), user);
	let welcomeSent = 0;
	let firstCreationNudgeSent = 0;
	const failures = [];
	if (!settings.dryRun) {
		for (const id of welcomeIds) {
			const user = byId.get(id);
			if (!hasEmail(user?.email)) continue;
			try {
				await deliverOne(client, { user, profile: profiles.get(id), campaign: "welcome", template: "welcome", column: "welcome_email_sent_at", settings, deliver });
				welcomeSent += 1;
			} catch (error) {
				failures.push({ userId: id, campaign: "welcome", error: error.message || String(error) });
			}
		}
		for (const id of nudgeIds) {
			const user = byId.get(id);
			if (!hasEmail(user?.email)) continue;
			try {
				await deliverOne(client, { user, profile: profiles.get(id), campaign: "first_creation_nudge", template: "firstCreationNudge", column: "first_creation_nudge_sent_at", settings, deliver });
				firstCreationNudgeSent += 1;
			} catch (error) {
				failures.push({ userId: id, campaign: "first_creation_nudge", error: error.message || String(error) });
			}
		}
	}
	const message = settings.dryRun
		? `Dry run. Welcome eligible: ${welcomeIds.length}. First-creation nudge eligible: ${nudgeIds.length}. Nothing delivered.`
		: `Welcome: ${welcomeSent} sent. First-creation nudge: ${firstCreationNudgeSent} sent.`;
	return {
		ok: failures.length === 0,
		dryRun: settings.dryRun,
		welcomeEligible: welcomeIds.length,
		firstCreationNudgeEligible: nudgeIds.length,
		welcomeSent,
		firstCreationNudgeSent,
		failures,
		message
	};
}

export function startWelcomeMailSchedule({ client, intervalMs = 15 * 60 * 1000 } = {}) {
	if (!client) return () => {};
	const tick = () => {
		runWelcomeMail({ client }).catch((error) => console.warn("[welcome-mail]", error?.message || error));
	};
	const timer = setInterval(tick, intervalMs);
	timer.unref?.();
	return () => clearInterval(timer);
}
