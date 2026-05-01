import { parseIso } from '../constants.js';
import { deriveChallengePhase } from './phases.js';
import { extractChallengeEvents } from './extractEvents.js';
import { CHALLENGE_SCORE_REACTION_KEYS } from '../constants.js';
import { weightedScoreFromReactions } from '../constants.js';

/**
 * Latest config by message created_at (participant-focused thread view).
 */
export function pickLatestConfig(configEntries) {
	let latestConfig = /** @type {object | null} */ (null);
	let latestConfigMsg = /** @type {object | null} */ (null);

	for (const { msg, payload } of configEntries) {
		const curMs = parseIso(msg?.created_at) ?? 0;
		const prevMs = latestConfigMsg ? parseIso(latestConfigMsg?.created_at) ?? 0 : -1;
		if (!latestConfigMsg || curMs >= prevMs) {
			latestConfig = payload;
			latestConfigMsg = msg;
		}
	}

	return { latestConfig, latestConfigMsg };
}

/**
 * Submissions whose challenge_id matches the latest config.
 */
export function submissionsForLatestChallenge(submissions, latestConfig) {
	const challengeId =
		latestConfig && typeof latestConfig.challenge_id === 'string'
			? latestConfig.challenge_id.trim()
			: latestConfig && latestConfig.challenge_id != null
				? String(latestConfig.challenge_id).trim()
				: '';

	if (!challengeId) return [];

	return submissions.filter((s) => {
		const id =
			s.payload && s.payload.challenge_id != null
				? String(s.payload.challenge_id).trim()
				: '';
		return id === challengeId;
	});
}

/**
 * @param {{ msg: object, payload: object }[]} submissionsForChallenge
 * @param {Map<number, object>} [reactionsByMessageId]
 */
export function rankSubmissionsForChallenge(submissionsForChallenge, reactionsByMessageId) {
	const enriched = submissionsForChallenge.map(({ msg, payload }) => {
		const mid = msg?.id != null ? Number(msg.id) : null;
		const reactions =
			mid != null && reactionsByMessageId instanceof Map
				? reactionsByMessageId.get(mid)
				: msg?.reactions && typeof msg.reactions === 'object'
					? msg.reactions
					: {};
		const score = weightedScoreFromReactions(reactions);
		const createdImageId =
			payload?.created_image_id != null ? Number(payload.created_image_id) : NaN;
		const senderId = msg?.sender_id != null ? Number(msg.sender_id) : null;
		const viewerVote = Array.isArray(msg?.viewer_reactions)
			? CHALLENGE_SCORE_REACTION_KEYS.find((k) => msg.viewer_reactions.includes(k)) || null
			: null;
		return {
			msg,
			payload,
			messageId: mid,
			score,
			creationId: Number.isFinite(createdImageId) && createdImageId > 0 ? createdImageId : null,
			senderId,
			viewerVote,
			reactions: reactions || {}
		};
	});
	return enriched.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		const ta = parseIso(a.msg?.created_at) ?? 0;
		const tb = parseIso(b.msg?.created_at) ?? 0;
		return ta - tb;
	});
}

/**
 * Map message id → reactions object from full thread messages.
 * @param {object[]} messages
 */
export function buildReactionsByMessageId(messages) {
	const reactionMap = new Map();
	for (const m of messages) {
		const id = m?.id != null ? Number(m.id) : null;
		if (!Number.isFinite(id) || id <= 0) continue;
		if (m.reactions && typeof m.reactions === 'object') reactionMap.set(id, m.reactions);
	}
	return reactionMap;
}

/**
 * Participant-facing slice: latest challenge + phase + ranked submissions.
 * @param {{ configs: object[], submissions: object[] }} extracted from {@link extractChallengeEvents}
 * @param {object[]} messages full thread (for reaction map)
 * @param {number} nowMs
 */
export function buildParticipantSliceFromExtracted(extracted, messages, nowMs) {
	const { configs, submissions } = extracted;
	const { latestConfig, latestConfigMsg } = pickLatestConfig(configs);
	const phase = deriveChallengePhase(latestConfig, nowMs);
	const forChallenge = submissionsForLatestChallenge(submissions, latestConfig);
	const reactionMap = buildReactionsByMessageId(messages);
	const rankedSubmissions = rankSubmissionsForChallenge(forChallenge, reactionMap);

	return {
		latestConfig,
		latestConfigMsg,
		phase,
		rankedSubmissions,
		reactionMap,
		rawConfigCount: configs.length
	};
}

/**
 * @param {object[]} messages
 * @param {number} nowMs
 */
export function buildParticipantSlice(messages, nowMs) {
	return buildParticipantSliceFromExtracted(extractChallengeEvents(messages), messages, nowMs);
}
