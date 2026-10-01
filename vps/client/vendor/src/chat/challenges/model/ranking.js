/**
 * Canonical challenge ranking — the ONE implementation money rides on.
 *
 * Consumers: organizer stats modal (adminView.js), results/payout tab
 * (organizeResults.js), and the publish-results route (api_routes/challenges.js).
 *
 * Two sort algorithms (same as the organizer stats modal):
 * - 'weighted' (default): Bayesian weighted rating —
 *   (voteCount * averageVote + MIN_VOTES * globalAverage) / (voteCount + MIN_VOTES)
 * - 'average': plain average vote.
 *
 * Exclusion: usernames filtered out of every leaderboard (defaults to the
 * viewing organizer, same as the stats modal).
 */

import { CHALLENGE_SCORE_REACTION_KEYS } from '../constants.js';

export const WEIGHTED_RATING_MIN_VOTES = 15;

/**
 * @param {unknown} raw csv string or array of names
 * @returns {string[]} normalized lowercase usernames (no @, deduped)
 */
export function normalizeExcludedUserNames(raw) {
	const parts = Array.isArray(raw) ? raw : String(raw || '').split(',');
	const seen = new Set();
	const out = [];
	for (const part of parts) {
		const name = String(part || '').trim().replace(/^@+/, '').toLowerCase();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out;
}

/**
 * @param {unknown} body
 */
function tryParseJsonBody(body) {
	if (body == null) return null;
	const s = String(body).trim();
	if (!s || !s.startsWith('{')) return null;
	try {
		const o = JSON.parse(s);
		return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
	} catch {
		return null;
	}
}

/**
 * Aggregate vote stats for one challenge from raw thread messages.
 * globalAverage spans ALL challenge_submission messages in the list
 * (thread-wide), matching the stats route's global average.
 *
 * @param {{ id?: unknown, sender_id?: unknown, body?: unknown, reactions?: object, created_at?: string }[]} messages chronological
 * @param {string} challengeId
 * @returns {{
 *   entries: { messageId: number, senderId: number | null, creationId: number | null, voteValue: number, voteCount: number, createdAt: string | null }[],
 *   votesPerUserId: Map<number, number>,
 *   submissionsPerSenderId: Map<number, number>,
 *   globalAverage: number,
 * }}
 */
export function collectChallengeVoteStats(messages, challengeId) {
	const cid = String(challengeId || '').trim();
	const entries = [];
	const votesPerUserId = new Map();
	const submissionsPerSenderId = new Map();
	let globalVoteValue = 0;
	let globalVoteCount = 0;

	for (const msg of Array.isArray(messages) ? messages : []) {
		const payload = tryParseJsonBody(msg?.body);
		if (!payload || String(payload.kind || '').trim() !== 'challenge_submission') continue;
		const reactions =
			msg?.reactions && typeof msg.reactions === 'object' && !Array.isArray(msg.reactions)
				? msg.reactions
				: {};
		const isTarget = String(payload.challenge_id || '').trim() === cid;

		let voteValue = 0;
		let voteCount = 0;
		for (let i = 0; i < CHALLENGE_SCORE_REACTION_KEYS.length; i += 1) {
			const key = CHALLENGE_SCORE_REACTION_KEYS[i];
			const weight = i + 1;
			const ids = Array.isArray(reactions[key]) ? reactions[key] : [];
			for (const rawUid of ids) {
				const uid = Number(rawUid);
				if (!Number.isFinite(uid) || uid <= 0) continue;
				globalVoteCount += 1;
				globalVoteValue += weight;
				if (!isTarget) continue;
				voteCount += 1;
				voteValue += weight;
				votesPerUserId.set(uid, (votesPerUserId.get(uid) || 0) + 1);
			}
		}
		if (!isTarget) continue;

		const senderId = Number(msg?.sender_id);
		if (Number.isFinite(senderId) && senderId > 0) {
			submissionsPerSenderId.set(senderId, (submissionsPerSenderId.get(senderId) || 0) + 1);
		}
		const creationId = Number(payload.created_image_id);
		const messageId = Number(msg?.id);
		entries.push({
			messageId: Number.isFinite(messageId) && messageId > 0 ? messageId : 0,
			senderId: Number.isFinite(senderId) && senderId > 0 ? senderId : null,
			creationId: Number.isFinite(creationId) && creationId > 0 ? creationId : null,
			voteValue,
			voteCount,
			createdAt: typeof msg?.created_at === 'string' ? msg.created_at : null
		});
	}

	return {
		entries,
		votesPerUserId,
		submissionsPerSenderId,
		globalAverage: globalVoteCount > 0 ? globalVoteValue / globalVoteCount : 0
	};
}

/**
 * @param {{ voteValue?: unknown, voteCount?: unknown }} row
 * @returns {{ voteValue: number, voteCount: number, averageVote: number }}
 */
export function statsRowVoteNumbers(row) {
	const voteValue = Number.isFinite(Number(row?.voteValue))
		? Math.max(0, Number(row.voteValue))
		: 0;
	const voteCount = Number.isFinite(Number(row?.voteCount))
		? Math.max(0, Number(row.voteCount))
		: 0;
	return {
		voteValue,
		voteCount,
		averageVote: voteCount > 0 ? voteValue / voteCount : 0
	};
}

/**
 * Bayesian weighted rating for one entry.
 * @param {{ voteValue?: unknown, voteCount?: unknown }} row
 * @param {number} globalAverage
 * @param {number} [minVotes]
 */
export function weightedRatingForStatsRow(row, globalAverage, minVotes = WEIGHTED_RATING_MIN_VOTES) {
	const { voteCount, averageVote } = statsRowVoteNumbers(row);
	const g = Number.isFinite(Number(globalAverage)) ? Math.max(0, Number(globalAverage)) : 0;
	return (voteCount * averageVote + minVotes * g) / (voteCount + minVotes);
}

/**
 * Rank stats-endpoint topCreations rows (also accepts collectChallengeVoteStats
 * entries decorated with creator names). Canonical order:
 * - 'weighted': weightedRating desc → averageVote desc → voteCount desc → messageId asc
 * - 'average':  averageVote desc → voteCount desc → messageId asc
 *
 * @param {{ creationId?: number|null, messageId?: number|null, voteValue: number, voteCount: number, creatorUserId?: number|null, creatorUserName?: string|null }[]} rows
 * @param {{ sortMode?: 'weighted' | 'average', globalAverage?: number, excludedUserNames?: string[] | string }} [opts]
 * @returns {(typeof rows[number] & { averageVote: number, weightedRating: number })[]}
 */
export function rankStatsTopCreations(rows, opts = {}) {
	const sortMode = opts.sortMode === 'average' ? 'average' : 'weighted';
	const globalAverage = Number.isFinite(Number(opts.globalAverage))
		? Math.max(0, Number(opts.globalAverage))
		: 0;
	const excludedSet = new Set(normalizeExcludedUserNames(opts.excludedUserNames));
	const decorated = (Array.isArray(rows) ? rows : [])
		.filter((row) => {
			const name =
				row?.creatorUserName != null
					? String(row.creatorUserName).trim().toLowerCase()
					: '';
			return !name || !excludedSet.has(name);
		})
		.map((row) => {
			const nums = statsRowVoteNumbers(row);
			return {
				...row,
				averageVote: nums.averageVote,
				weightedRating: weightedRatingForStatsRow(row, globalAverage)
			};
		});
	decorated.sort((a, b) => {
		if (sortMode === 'weighted' && b.weightedRating !== a.weightedRating) {
			return b.weightedRating - a.weightedRating;
		}
		if (b.averageVote !== a.averageVote) return b.averageVote - a.averageVote;
		if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
		const am = Number(a.messageId) || 0;
		const bm = Number(b.messageId) || 0;
		return am - bm;
	});
	return decorated;
}

/**
 * Top voters leaderboard: vote count desc → user id asc. Excluded names removed.
 * @param {{ userId: number, voteCount: number, userName?: string | null }[]} rows
 * @param {{ excludedUserNames?: string[] | string }} [opts]
 */
export function rankTopVoters(rows, opts = {}) {
	return rankUserCountRows(rows, 'voteCount', opts);
}

/**
 * Top submitters leaderboard: submission count desc → user id asc. Excluded names removed.
 * @param {{ userId: number, submissionCount: number, userName?: string | null }[]} rows
 * @param {{ excludedUserNames?: string[] | string }} [opts]
 */
export function rankTopSubmitters(rows, opts = {}) {
	return rankUserCountRows(rows, 'submissionCount', opts);
}

function rankUserCountRows(rows, countKey, opts = {}) {
	const excludedSet = new Set(normalizeExcludedUserNames(opts.excludedUserNames));
	const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
		const name = row?.userName != null ? String(row.userName).trim().toLowerCase() : '';
		return !name || !excludedSet.has(name);
	});
	return [...filtered].sort((a, b) => {
		const ac = Number(a?.[countKey]) || 0;
		const bc = Number(b?.[countKey]) || 0;
		if (bc !== ac) return bc - ac;
		return (Number(a?.userId) || 0) - (Number(b?.userId) || 0);
	});
}

/**
 * Default winner selection: top N ranked entries, one entry per creator
 * (a creator with two strong entries wins one place, not two).
 *
 * @param {{ messageId?: number|null, creationId?: number|null, creatorUserId?: number|null }[]} rankedRows output of rankStatsTopCreations
 * @param {number} [places]
 * @returns {{ place: number, messageId: number, creationId: number | null, userId: number | null }[]}
 */
export function defaultWinnersFromRanked(rankedRows, places = 3) {
	const out = [];
	const seenCreators = new Set();
	for (const row of Array.isArray(rankedRows) ? rankedRows : []) {
		if (out.length >= places) break;
		const uid = Number(row?.creatorUserId);
		const creatorKey = Number.isFinite(uid) && uid > 0 ? uid : `msg-${row?.messageId}`;
		if (seenCreators.has(creatorKey)) continue;
		seenCreators.add(creatorKey);
		out.push({
			place: out.length + 1,
			messageId: Number(row?.messageId) || 0,
			creationId: row?.creationId != null ? Number(row.creationId) : null,
			userId: Number.isFinite(uid) && uid > 0 ? uid : null
		});
	}
	return out;
}
