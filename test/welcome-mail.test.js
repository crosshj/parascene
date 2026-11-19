import assert from "node:assert/strict";
import test from "node:test";
import { nudgeRecipientIds, runWelcomeMail, welcomeRecipientIds } from "../server/services/account/welcomeMail.js";

test("welcome recipients skip accounts that already received the email", () => {
	const ids = welcomeRecipientIds([
		{ id: 1, email: "new@example.com" },
		{ id: 2, email: "old@example.com" },
		{ id: 3, email: "not-an-email" }
	], [2]);
	assert.deepEqual(ids, [1]);
});

test("first-creation nudge skips welcome portraits and people who already published", () => {
	const ids = nudgeRecipientIds([
		{ user_id: 1, welcome_email_sent_at: "2026-11-01T00:00:00.000Z", first_creation_nudge_sent_at: null },
		{ user_id: 2, welcome_email_sent_at: "2026-11-01T00:00:00.000Z", first_creation_nudge_sent_at: null },
		{ user_id: 3, welcome_email_sent_at: "2026-11-18T00:00:00.000Z", first_creation_nudge_sent_at: null }
	], [
		{ user_id: 1, title: "Welcome @ada", filename: "welcome_1.png", meta: { new_user: true } },
		{ user_id: 2, title: "A real post", filename: "post.png", meta: {} }
	], "2026-11-17T00:00:00.000Z");
	assert.deepEqual(ids, [1]);
});

function memoryClient() {
	const tables = {
		prsn_policy_knobs: [
			{ key: "email_dry_run", value: "false" },
			{ key: "email_use_test_recipient", value: "false" },
			{ key: "welcome_email_delay_hours", value: "1" },
			{ key: "digest_utc_windows", value: "09:00" }
		],
		prsn_users: [
			{ id: 1, email: "new@example.com", created_at: "2026-11-01T00:00:00.000Z" },
			{ id: 2, email: "waiting@example.com", created_at: "2026-11-01T00:00:00.000Z" }
		],
		prsn_email_user_campaign_state: [
			{ user_id: 2, welcome_email_sent_at: "2026-11-01T00:00:00.000Z", first_creation_nudge_sent_at: null }
		],
		prsn_created_images: [
			{ id: 9, user_id: 2, title: "Welcome @wait", filename: "welcome_2.png", meta: { new_user: true }, published: true, unavailable_at: null }
		],
		prsn_user_profiles: [
			{ user_id: 1, user_name: "ada", display_name: "Ada" }
		],
		prsn_email_sends: []
	};
	function from(name) {
		const filters = [];
		const api = {
			select() { return api; },
			not(column) { filters.push((row) => row[column] != null); return api; },
			lte(column, value) { filters.push((row) => row[column] <= value); return api; },
			eq(column, value) { filters.push((row) => row[column] === value); return api; },
			is(column, value) { filters.push((row) => (value == null ? row[column] == null : row[column] === value)); return api; },
			in(column, values) {
				const allowed = new Set(values.map((value) => String(value)));
				filters.push((row) => allowed.has(String(row[column])));
				return Promise.resolve({ data: tables[name].filter((row) => filters.every((check) => check(row))), error: null });
			},
			order() { return api; },
			range(fromIndex, toIndex) {
				return Promise.resolve({ data: tables[name].filter((row) => filters.every((check) => check(row))).slice(fromIndex, toIndex + 1), error: null });
			},
			insert(row) {
				tables[name].push(row);
				return { select() { return { single: () => Promise.resolve({ data: { id: tables[name].length }, error: null }) }; } };
			},
			upsert(row) {
				const existing = tables[name].find((item) => item.user_id === row.user_id);
				if (existing) Object.assign(existing, row);
				else tables[name].push({ ...row });
				return Promise.resolve({ error: null });
			}
		};
		return api;
	}
	return { from, tables };
}

test("welcome mail stays quiet outside the digest window", async () => {
	const client = memoryClient();
	const delivered = [];
	const result = await runWelcomeMail({
		client,
		now: new Date("2026-11-19T15:00:00.000Z"),
		deliver: async (message) => { delivered.push(message); }
	});
	assert.equal(result.reason, "not_in_window");
	assert.equal(delivered.length, 0);
});

test("welcome mail sends the welcome and the later nudge", async () => {
	const previousKey = process.env.RESEND_API_KEY;
	const previousFrom = process.env.RESEND_SYSTEM_EMAIL;
	process.env.RESEND_API_KEY = "test-key";
	process.env.RESEND_SYSTEM_EMAIL = "mail@example.com";
	try {
		const client = memoryClient();
		const delivered = [];
		const result = await runWelcomeMail({
			client,
			now: new Date("2026-11-19T15:00:00.000Z"),
			force: true,
			deliver: async (message) => { delivered.push(message); }
		});
		assert.equal(result.welcomeSent, 1);
		assert.equal(result.firstCreationNudgeSent, 1);
		assert.deepEqual(delivered.map((message) => message.template), ["welcome", "firstCreationNudge"]);
		assert.equal(delivered[0].to, "new@example.com");
		assert.equal(delivered[0].data.recipientName, "Ada");
		assert.equal(delivered[1].to, "waiting@example.com");
		assert.equal(client.tables.prsn_email_user_campaign_state.find((row) => row.user_id === 1).welcome_email_sent_at != null, true);
		assert.equal(client.tables.prsn_email_user_campaign_state.find((row) => row.user_id === 2).first_creation_nudge_sent_at != null, true);
	} finally {
		if (previousKey === undefined) delete process.env.RESEND_API_KEY;
		else process.env.RESEND_API_KEY = previousKey;
		if (previousFrom === undefined) delete process.env.RESEND_SYSTEM_EMAIL;
		else process.env.RESEND_SYSTEM_EMAIL = previousFrom;
	}
});
