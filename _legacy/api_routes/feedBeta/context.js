import { collectCreationMentionSourceTexts, extractUserMentionHandles } from '../utils/textMentions.js';
import { FEED_BETA_DEFAULT_PARAMS } from './params.js';

/**
 * @param {object} queries
 * @param {number} userId
 * @returns {Promise<Set<string>>}
 */
export async function loadFollowingIdSet(queries, userId) {
	const out = new Set();
	if (userId == null || typeof queries.selectUserFollowing?.all !== 'function') {
		return out;
	}
	const rows = await queries.selectUserFollowing.all(userId, { limit: 500, offset: 0 });
	for (const row of Array.isArray(rows) ? rows : []) {
		const id = row?.user_id ?? row?.following_id;
		if (id != null) out.add(String(id));
	}
	return out;
}

/**
 * @param {object} queries
 * @param {object[]} catalogRows
 * @param {number} [newcomerDays]
 * @returns {Promise<{ newcomerAuthorIds: Set<string>, newcomerHandles: Set<string> }>}
 */
/** Max distinct authors loaded for newcomer pool context per request. */
const NEWCOMER_AUTHOR_LOOKUP_CAP = 80;

export async function loadNewcomerAuthorContext(
	queries,
	catalogRows,
	newcomerDays = FEED_BETA_DEFAULT_PARAMS.newcomerAccountDays
) {
	const authorIds = [
		...new Set(
			(Array.isArray(catalogRows) ? catalogRows : [])
				.map((r) => Number(r.user_id))
				.filter((id) => Number.isFinite(id) && id > 0)
		)
	].slice(0, NEWCOMER_AUTHOR_LOOKUP_CAP);
	const newcomerAuthorIds = new Set();
	const newcomerHandles = new Set();
	if (authorIds.length === 0) {
		return { newcomerAuthorIds, newcomerHandles };
	}

	const cutoff = Date.now() - newcomerDays * 24 * 60 * 60 * 1000;
	if (typeof queries.selectUsersByIds === 'function') {
		const userMap = await queries.selectUsersByIds(authorIds);
		for (const [id, u] of userMap.entries()) {
			const created = Date.parse(u?.created_at ?? '');
			if (Number.isFinite(created) && created >= cutoff) {
				newcomerAuthorIds.add(String(id));
			}
		}
	}

	if (newcomerAuthorIds.size > 0 && typeof queries.selectUserProfilesByUserIds === 'function') {
		const profileMap = await queries.selectUserProfilesByUserIds(
			[...newcomerAuthorIds].map((id) => Number(id)).filter((n) => Number.isFinite(n))
		);
		for (const [uid, profile] of profileMap.entries()) {
			if (!newcomerAuthorIds.has(String(uid))) continue;
			const handle = typeof profile?.user_name === 'string' ? profile.user_name.trim().toLowerCase() : '';
			if (handle) newcomerHandles.add(handle);
		}
	}

	return { newcomerAuthorIds, newcomerHandles };
}

/**
 * @param {object} row
 * @param {Set<string>} newcomerHandles
 * @returns {boolean}
 */
export function rowMentionsNewcomerHandle(row, newcomerHandles) {
	if (!(newcomerHandles instanceof Set) || newcomerHandles.size === 0) return false;
	const texts = collectCreationMentionSourceTexts({
		title: row.title,
		description: row.summary,
		meta: row.meta
	});
	for (const text of texts) {
		for (const handle of extractUserMentionHandles(text)) {
			if (newcomerHandles.has(handle)) return true;
		}
	}
	return false;
}
