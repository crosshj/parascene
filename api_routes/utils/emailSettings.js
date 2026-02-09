const EMAIL_USE_TEST_RECIPIENT_KEY = "email_use_test_recipient";
const RESEND_TEST_ADDRESS = "delivered@resend.dev";

/**
 * Returns true if admin has set email_use_test_recipient so that all
 * lifecycle/transactional emails go to Resend's test address.
 * @param {{ selectPolicyByKey?: { get: (key: string) => Promise<{ value?: string } | null> } }} queries
 * @returns {Promise<boolean>}
 */
export async function getEmailUseTestRecipient(queries) {
	if (!queries?.selectPolicyByKey?.get) return false;
	const row = await queries.selectPolicyByKey.get(EMAIL_USE_TEST_RECIPIENT_KEY);
	const v = row?.value;
	if (v == null || typeof v !== "string") return false;
	const trimmed = v.trim().toLowerCase();
	return trimmed === "true" || trimmed === "1";
}

/**
 * Returns the recipient to use for sending: either the intended address
 * or the Resend test address when test mode is on.
 * @param {{ selectPolicyByKey?: { get: (key: string) => Promise<{ value?: string } | null> } }} queries
 * @param {string} intendedRecipient
 * @returns {Promise<string>}
 */
export async function getEffectiveEmailRecipient(queries, intendedRecipient) {
	const useTest = await getEmailUseTestRecipient(queries);
	return useTest ? RESEND_TEST_ADDRESS : intendedRecipient;
}

/**
 * Get a policy knob value by key.
 * @param {{ selectPolicyByKey?: { get: (key: string) => Promise<{ value?: string } | null> } }} queries
 * @param {string} key
 * @param {string} [defaultValue]
 * @returns {Promise<string>}
 */
export async function getPolicyValue(queries, key, defaultValue = "") {
	if (!queries?.selectPolicyByKey?.get) return defaultValue;
	const row = await queries.selectPolicyByKey.get(key);
	const v = row?.value;
	return typeof v === "string" ? v.trim() : defaultValue;
}

/**
 * Settings for the digest cron: dry run, UTC windows (e.g. "09:00,18:00"), max digests per user per day.
 * @param {{ selectPolicyByKey?: { get: (key: string) => Promise<{ value?: string } | null> } }} queries
 * @returns {Promise<{ dryRun: boolean, windowHours: number[], maxDigestsPerUserPerDay: number }>}
 */
export async function getCronDigestSettings(queries) {
	const dryRunVal = await getPolicyValue(queries, "email_dry_run", "true");
	const dryRun = dryRunVal.toLowerCase() === "true" || dryRunVal === "1";

	const windowsVal = await getPolicyValue(queries, "digest_utc_windows", "09:00,18:00");
	const windowHours = windowsVal
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => {
			const [h, m] = s.split(":").map(Number);
			return Number.isFinite(h) ? h : null;
		})
		.filter((h) => h != null && h >= 0 && h <= 23);

	const maxVal = await getPolicyValue(queries, "max_digests_per_user_per_day", "2");
	const maxDigestsPerUserPerDay = Math.max(0, parseInt(maxVal, 10) || 2);

	return { dryRun, windowHours, maxDigestsPerUserPerDay };
}

const WELCOME_EMAIL_DELAY_HOURS_KEY = "welcome_email_delay_hours";

/**
 * Hours after account creation before a user is eligible for the welcome email.
 * Default 1 so we don't send welcome in the same cron run as signup.
 * @param {{ selectPolicyByKey?: { get: (key: string) => Promise<{ value?: string } | null> } }} queries
 * @returns {Promise<number>}
 */
export async function getWelcomeEmailDelayHours(queries) {
	const val = await getPolicyValue(queries, WELCOME_EMAIL_DELAY_HOURS_KEY, "1");
	const n = parseInt(val, 10);
	return Number.isFinite(n) && n >= 0 ? n : 1;
}
