/**
 * Fill `author_plan` from `users.meta.plan` when a feed row never joined it.
 * Classic SQL feed already sets this; catalog hydration did not.
 *
 * @param {object} queries
 * @param {object[]} rows
 * @returns {Promise<object[]>}
 */
export async function stampAuthorPlanOnCreationRows(queries, rows) {
	if (!Array.isArray(rows) || rows.length === 0) return rows;
	if (typeof queries?.selectUsersByIds !== 'function') return rows;

	const missingIds = [
		...new Set(
			rows
				.filter((row) => row?.author_plan !== 'founder' && row?.author_plan !== 'free')
				.map((row) => Number(row?.user_id))
				.filter((id) => Number.isFinite(id) && id > 0)
		)
	];
	if (missingIds.length === 0) return rows;

	let userMap = new Map();
	try {
		userMap = await queries.selectUsersByIds(missingIds);
	} catch {
		return rows;
	}
	if (!(userMap instanceof Map) || userMap.size === 0) return rows;

	return rows.map((row) => {
		if (row?.author_plan === 'founder' || row?.author_plan === 'free') return row;
		const uid = Number(row?.user_id);
		const user = Number.isFinite(uid) ? userMap.get(uid) : null;
		if (!user) return row;
		const meta = user.meta && typeof user.meta === 'object' ? user.meta : {};
		return {
			...row,
			author_plan: meta.plan === 'founder' ? 'founder' : 'free'
		};
	});
}
