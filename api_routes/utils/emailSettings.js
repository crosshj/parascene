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
