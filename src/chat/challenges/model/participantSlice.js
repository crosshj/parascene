import { parseIso } from '../constants.js';
import { deriveChallengePhase } from './phases.js';
import { extractChallengeEvents } from './extractEvents.js';
import { CHALLENGE_SCORE_REACTION_KEYS } from '../constants.js';
import { weightedScoreFromReactions } from '../constants.js';
import { summarizeLatestChallengeConfigs } from './organizerSummaries.js';
import { mergeFullChallengeConfigForChallenge } from '../challengeAdmin.js';

/** Phases where the main challenge pane shows submissions / voting UI. */
export const ACTIVE_PARTICIPANT_PHASES = new Set(['submitting', 'voting', 'submit_and_vote']);

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
 * Latest chat row for one challenge_id (by message created_at).
 * @param {{ msg: object, payload: object }[]} configEntries
 * @param {string} challengeId
 */
export function pickLatestConfigMsgForChallenge(configEntries, challengeId) {
	const cid = String(challengeId || '').trim();
	if (!cid) return null;
	let latestConfigMsg = /** @type {object | null} */ (null);
	for (const { msg, payload } of configEntries || []) {
		const rowCid =
			payload && payload.challenge_id != null ? String(payload.challenge_id).trim() : '';
		if (rowCid !== cid) continue;
		const curMs = parseIso(msg?.created_at) ?? 0;
		const prevMs = latestConfigMsg ? parseIso(latestConfigMsg?.created_at) ?? 0 : -1;
		if (!latestConfigMsg || curMs >= prevMs) {
			latestConfigMsg = msg;
		}
	}
	return latestConfigMsg;
}

/**
 * Participant focus: prefer a currently active challenge over the most recently edited config row.
 * @param {{ msg: object, payload: object }[]} configEntries
 * @param {number} nowMs
 */
export function pickParticipantFocusConfig(configEntries, nowMs) {
	const summaries = summarizeLatestChallengeConfigs(configEntries);
	/** @type {{ challengeId: string, payload: object, phase: string, sortKey: number, endMs: number }[]} */
	const active = [];

	for (const summary of summaries) {
		const cid = String(summary.challenge_id || '').trim();
		if (!cid) continue;
		const merged = mergeFullChallengeConfigForChallenge(configEntries, cid);
		const phase = deriveChallengePhase(merged, nowMs);
		if (!ACTIVE_PARTICIPANT_PHASES.has(phase)) continue;
		const endMs =
			parseIso(merged.voting_end_at) ??
			parseIso(merged.submission_end_at) ??
			Number.POSITIVE_INFINITY;
		active.push({
			challengeId: cid,
			payload: merged,
			phase,
			sortKey: summary.sortKey,
			endMs
		});
	}

	if (active.length) {
		active.sort((a, b) => {
			if (a.endMs !== b.endMs) return a.endMs - b.endMs;
			return b.sortKey - a.sortKey;
		});
		const pick = active[0];
		return {
			latestConfig: pick.payload,
			latestConfigMsg: pickLatestConfigMsgForChallenge(configEntries, pick.challengeId)
		};
	}

	const { latestConfig: rawLatest, latestConfigMsg } = pickLatestConfig(configEntries);
	if (!rawLatest) {
		return { latestConfig: null, latestConfigMsg: null };
	}
	const cid =
		rawLatest.challenge_id != null ? String(rawLatest.challenge_id).trim() : '';
	if (!cid) {
		return { latestConfig: rawLatest, latestConfigMsg };
	}
	return {
		latestConfig: mergeFullChallengeConfigForChallenge(configEntries, cid),
		latestConfigMsg: pickLatestConfigMsgForChallenge(configEntries, cid)
	};
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
 * Rows you may score in blind voting (excludes the viewer’s own submission(s)).
 * @param {object[]} ranked — output of {@link rankSubmissionsForChallenge}
 * @param {number | null | undefined} viewerId
 */
export function rankedSubmissionsForPeerVoting(ranked, viewerId) {
	const arr = Array.isArray(ranked) ? ranked : [];
	const vid = Number(viewerId);
	if (!Number.isFinite(vid) || vid <= 0) return arr;
	return arr.filter((r) => {
		const sid = r.senderId != null ? Number(r.senderId) : NaN;
		if (!Number.isFinite(sid)) return true;
		return sid !== vid;
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
	const { latestConfig, latestConfigMsg } = pickParticipantFocusConfig(configs, nowMs);
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
