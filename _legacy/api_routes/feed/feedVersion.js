/**
 * Bump global feed version so clients polling `/api/feed/version` refresh page 1.
 * @param {object} queries
 */
export async function bumpFeedVersionCounter(queries) {
	if (!queries.selectPolicyByKey?.get || !queries.upsertPolicyKey?.run) return;
	const key = 'version_feed';
	const description =
		'Global feed cache version. Increment when published feed content changes.';
	try {
		const row = await queries.selectPolicyByKey.get(key);
		const current = Number.parseInt(String(row?.value ?? '0'), 10);
		const next = Number.isFinite(current) && current >= 0 ? current + 1 : 1;
		await queries.upsertPolicyKey.run(key, String(next), description);
	} catch (err) {
		console.warn('[feed] Failed to bump feed version:', err?.message || err);
	}
}
